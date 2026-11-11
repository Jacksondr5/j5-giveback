// Agent endpoints: bearer AGENT_SECRET. Agents write item state here and read it back.
//
// Each handler runs in one transaction. It validates the whole batch and reads
// what it needs before the first write, and returns 400 without writing when
// anything is wrong.

import { json, type EndpointRequest, type EndpointResponse, type QueryServerContext, type ServerContext } from "lakebed/server";
import {
  EXPORT_TABLES,
  type AsksResponse,
  type EventsResponse,
  type ExportResponse,
  type ExportTable,
  type ItemsResponse,
  type WriteStatus
} from "../shared/api";
import { ASK_KIND_LABELS, OUTCOME_LABELS, STAGE_LABELS, type AskKind, type Outcome, type Stage } from "../shared/enums";
import { LIMITS } from "../shared/limits";
import { apiError, checkBearer } from "./auth";
import type { AskRow, ItemRow, LinkRow, ReadDb, WriteDb } from "./schema";
import {
  parseAsksRequest,
  parseEventsRequest,
  parseItemsRequest,
  type Issues,
  type ParsedAsk,
  type ParsedItem,
  type ParsedLink
} from "./validate";

/** Keys with this prefix belong to events the server records itself. */
export const AUTO_KEY_PREFIX = "auto:";

async function readBody(req: EndpointRequest): Promise<{ ok: true; body: unknown } | { ok: false; response: EndpointResponse }> {
  try {
    return { ok: true, body: await req.json() };
  } catch {
    return { ok: false, response: apiError(400, "invalid_json", "The request body is not valid JSON.") };
  }
}

function validationFailed(issues: Issues): EndpointResponse {
  return apiError(
    400,
    "validation_failed",
    `${issues.length} problem${issues.length === 1 ? "" : "s"} found. Nothing was applied.`,
    issues
  );
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export async function touchSyncState(
  db: WriteDb,
  patch: {
    lastGithubSyncAt?: number;
    lastGithubOkAt?: number;
    lastAgentPushAt?: number;
    lastError?: string | null;
    lastErrorAt?: number | null;
    refreshRunFailed?: boolean;
  }
): Promise<void> {
  const row = await db.syncState.withIndex("by_creation").first();
  if (row) {
    await db.syncState.update(row.id, patch);
  } else {
    await db.syncState.insert(patch);
  }
}

// ---------------------------------------------------------------------------
// POST /api/agent/items
// ---------------------------------------------------------------------------

// The stored fields an agent controls, with null for "no value".
type ItemState = {
  title: string;
  summary: string;
  stage: Stage;
  route: string | null;
  routeReason: string | null;
  waitingOn: string;
  waitingSince: number;
  outcome: string | null;
  closedAt: number | null;
  targetRepo: string;
  originRefs: string;
  foundAt: number;
  lastValidatedAt: number | null;
  lastValidatedSha: string | null;
  validationVerdict: string | null;
  followUpState: string;
  followUpNote: string | null;
  isPublic: boolean;
};

const ITEM_STATE_KEYS = [
  "title",
  "summary",
  "stage",
  "route",
  "routeReason",
  "waitingOn",
  "waitingSince",
  "outcome",
  "closedAt",
  "targetRepo",
  "originRefs",
  "foundAt",
  "lastValidatedAt",
  "lastValidatedSha",
  "validationVerdict",
  "followUpState",
  "followUpNote",
  "isPublic"
] as const satisfies readonly (keyof ItemState)[];

function stateOf(row: ItemRow): ItemState {
  return {
    title: row.title,
    summary: row.summary,
    stage: row.stage as Stage,
    route: row.route ?? null,
    routeReason: row.routeReason ?? null,
    waitingOn: row.waitingOn,
    waitingSince: row.waitingSince,
    outcome: row.outcome ?? null,
    closedAt: row.closedAt ?? null,
    targetRepo: row.targetRepo,
    originRefs: row.originRefs,
    foundAt: row.foundAt,
    lastValidatedAt: row.lastValidatedAt ?? null,
    lastValidatedSha: row.lastValidatedSha ?? null,
    validationVerdict: row.validationVerdict ?? null,
    followUpState: row.followUpState,
    followUpNote: row.followUpNote ?? null,
    isPublic: row.isPublic
  };
}

type ItemPlan = {
  input: ParsedItem;
  existing: ItemRow | null;
  next: ItemState;
};

/** Merges the request into the stored item and checks the rules that span fields. */
function planItem(issues: Issues, input: ParsedItem, existing: ItemRow | null, path: string, now: number): ItemPlan | null {
  const before = issues.length;
  const fields = input.fields;
  const current = existing ? stateOf(existing) : null;

  if (!current) {
    for (const field of ["title", "summary", "stage", "waitingOn", "targetRepo", "isPublic"] as const) {
      if (fields[field] === undefined) {
        issues.push({
          path: `${path}.${field}`,
          message: `Required to create an item. No item has the slug "${input.slug}".`
        });
      }
    }
    if (issues.length !== before) return null;
  }

  const stage = (fields.stage ?? current?.stage) as Stage;
  let outcome = fields.outcome !== undefined ? fields.outcome : (current?.outcome ?? null);
  let closedAt: number | null;
  if (stage === "closed") {
    if (!outcome) {
      issues.push({ path: `${path}.outcome`, message: 'Required when stage is "closed".' });
    }
    if (fields.closedAt === null) {
      issues.push({ path: `${path}.closedAt`, message: 'Must not be null when stage is "closed".' });
    }
    closedAt = fields.closedAt ?? (current?.stage === "closed" ? current.closedAt : null) ?? now;
  } else {
    if (fields.outcome) {
      issues.push({ path: `${path}.outcome`, message: 'Allowed only when stage is "closed".' });
    }
    if (typeof fields.closedAt === "number") {
      issues.push({ path: `${path}.closedAt`, message: 'Allowed only when stage is "closed".' });
    }
    // An item that moves back out of "closed" loses its outcome.
    outcome = null;
    closedAt = null;
  }
  if (issues.length !== before) return null;

  const waitingOn = (fields.waitingOn ?? current?.waitingOn) as string;
  const waitingSince =
    fields.waitingSince ?? (current && current.waitingOn === waitingOn ? current.waitingSince : now);

  const next: ItemState = {
    title: (fields.title ?? current?.title) as string,
    summary: (fields.summary ?? current?.summary) as string,
    stage,
    route: fields.route !== undefined ? fields.route : (current?.route ?? null),
    routeReason: fields.routeReason !== undefined ? fields.routeReason : (current?.routeReason ?? null),
    waitingOn,
    waitingSince,
    outcome,
    closedAt,
    targetRepo: (fields.targetRepo ?? current?.targetRepo) as string,
    originRefs: fields.originRefs ?? current?.originRefs ?? "",
    foundAt: fields.foundAt ?? current?.foundAt ?? now,
    lastValidatedAt: fields.lastValidatedAt !== undefined ? fields.lastValidatedAt : (current?.lastValidatedAt ?? null),
    lastValidatedSha:
      fields.lastValidatedSha !== undefined ? fields.lastValidatedSha : (current?.lastValidatedSha ?? null),
    validationVerdict:
      fields.validationVerdict !== undefined ? fields.validationVerdict : (current?.validationVerdict ?? null),
    followUpState: fields.followUpState ?? current?.followUpState ?? "none",
    followUpNote: fields.followUpNote !== undefined ? fields.followUpNote : (current?.followUpNote ?? null),
    isPublic: (fields.isPublic ?? current?.isPublic) as boolean
  };
  return { input, existing, next };
}

function stageEventNote(previous: ItemState | null, next: ItemState): string {
  const outcome = next.outcome ? ` (${OUTCOME_LABELS[next.outcome as Outcome]})` : "";
  if (!previous) {
    return `Recorded at stage ${STAGE_LABELS[next.stage]}${outcome}.`;
  }
  if (previous.stage === next.stage) {
    return `Outcome changed to ${OUTCOME_LABELS[next.outcome as Outcome]}.`;
  }
  return `${STAGE_LABELS[previous.stage]} → ${STAGE_LABELS[next.stage]}${outcome}.`;
}

/** Makes the item's links match `wanted`, keeping the GitHub snapshot of links that stay. */
async function replaceLinks(
  db: WriteDb,
  itemId: string,
  existing: LinkRow[],
  wanted: ParsedLink[],
  active: boolean
): Promise<boolean> {
  let changed = false;
  const byUrl = new Map(existing.map((row) => [row.url, row]));
  for (const link of wanted) {
    const row = byUrl.get(link.url);
    if (!row) {
      await db.links.insert({
        itemId,
        url: link.url,
        repo: link.repo,
        number: link.number,
        kind: link.kind,
        ownership: link.ownership,
        role: link.role,
        active,
        ...(link.triageBucket ? { triageBucket: link.triageBucket } : {}),
        ...(typeof link.triageRank === "number" ? { triageRank: link.triageRank } : {})
      });
      changed = true;
      continue;
    }
    byUrl.delete(link.url);
    const patch: Record<string, string | number | boolean | null> = {};
    if (row.repo !== link.repo) patch.repo = link.repo;
    if (row.number !== link.number) patch.number = link.number;
    if (row.kind !== link.kind) patch.kind = link.kind;
    if (row.ownership !== link.ownership) patch.ownership = link.ownership;
    if (row.role !== link.role) patch.role = link.role;
    if (row.active !== active) patch.active = active;
    if (link.triageBucket !== undefined && (row.triageBucket ?? null) !== link.triageBucket) {
      patch.triageBucket = link.triageBucket;
    }
    if (link.triageRank !== undefined && (row.triageRank ?? null) !== link.triageRank) {
      patch.triageRank = link.triageRank;
    }
    if (Object.keys(patch).length > 0) {
      await db.links.update(row.id, patch);
      changed = true;
    }
  }
  for (const row of byUrl.values()) {
    await db.links.delete(row.id);
    changed = true;
  }
  return changed;
}

/** Merges private fields into a one-row-per-parent private table. Returns true when something changed. */
async function mergePrivate<TFields extends string>(
  existing: (Record<string, unknown> & { id: string }) | null,
  wanted: Partial<Record<TFields, string | null>>,
  insert: (values: Partial<Record<TFields, string>>) => Promise<unknown>,
  update: (id: string, patch: Partial<Record<TFields, string | null>>) => Promise<unknown>
): Promise<boolean> {
  const entries = Object.entries(wanted) as [TFields, string | null][];
  if (!existing) {
    const values: Partial<Record<TFields, string>> = {};
    for (const [field, value] of entries) {
      if (value !== null) values[field] = value;
    }
    if (Object.keys(values).length === 0) return false;
    await insert(values);
    return true;
  }
  const patch: Partial<Record<TFields, string | null>> = {};
  for (const [field, value] of entries) {
    if ((existing[field] ?? null) !== value) patch[field] = value;
  }
  if (Object.keys(patch).length === 0) return false;
  await update(existing.id, patch);
  return true;
}

export async function handleItems(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  const db = ctx.db as unknown as WriteDb;
  const now = Date.now();

  const { items, issues } = parseItemsRequest(read.body, now);
  if (issues.length > 0) return validationFailed(issues);

  // Read and plan everything before the first write.
  const plans: ItemPlan[] = [];
  let creates = 0;
  for (const [index, input] of items.entries()) {
    const existing = await db.items.withIndex("by_slug", (q) => q.eq("slug", input.slug)).first();
    if (!existing) creates += 1;
    const plan = planItem(issues, input, existing, `items[${index}]`, now);
    if (plan) plans.push(plan);
  }
  if (creates > 0 && issues.length === 0) {
    const count = await db.items.withIndex("by_creation").count();
    if (count + creates > LIMITS.maxItems) {
      issues.push({
        path: "items",
        message: `This would store ${count + creates} items. The dashboard holds at most ${LIMITS.maxItems}.`
      });
    }
  }
  if (issues.length > 0) return validationFailed(issues);

  const results: ItemsResponse["results"] = [];
  for (const { input, existing, next } of plans) {
    const previous = existing ? stateOf(existing) : null;
    const active = next.stage !== "closed";
    let changed = false;
    let itemId: string;

    if (!existing) {
      const row = await db.items.insert({
        slug: input.slug,
        title: next.title,
        summary: next.summary,
        stage: next.stage,
        waitingOn: next.waitingOn,
        waitingSince: next.waitingSince,
        targetRepo: next.targetRepo,
        originRefs: next.originRefs,
        foundAt: next.foundAt,
        followUpState: next.followUpState,
        isPublic: next.isPublic,
        agentUpdatedAt: now,
        ...(next.route !== null ? { route: next.route } : {}),
        ...(next.routeReason !== null ? { routeReason: next.routeReason } : {}),
        ...(next.outcome !== null ? { outcome: next.outcome } : {}),
        ...(next.closedAt !== null ? { closedAt: next.closedAt } : {}),
        ...(next.lastValidatedAt !== null ? { lastValidatedAt: next.lastValidatedAt } : {}),
        ...(next.lastValidatedSha !== null ? { lastValidatedSha: next.lastValidatedSha } : {}),
        ...(next.validationVerdict !== null ? { validationVerdict: next.validationVerdict } : {}),
        ...(next.followUpNote !== null ? { followUpNote: next.followUpNote } : {})
      });
      itemId = row.id;
      changed = true;
    } else {
      itemId = existing.id;
    }

    const patch: Record<string, string | number | boolean | null> = {};
    if (previous) {
      for (const key of ITEM_STATE_KEYS) {
        if (previous[key] !== next[key]) patch[key] = next[key];
      }
      if (input.clearUpstreamChange && existing?.upstreamChangedAt !== undefined) {
        patch.upstreamChangedAt = null;
        patch.upstreamChangeNote = null;
      }
    }

    // Links. Read them when the set is replaced, or when closing or reopening flips `active`.
    const activeFlipped = previous !== null && (previous.stage !== "closed") !== active;
    if (existing && (input.links !== undefined || activeFlipped)) {
      const rows = await db.links.withIndex("by_item", (q) => q.eq("itemId", itemId)).take(LIMITS.linksPerItem * 2);
      if (input.links !== undefined) {
        if (await replaceLinks(db, itemId, rows, input.links, active)) changed = true;
      } else {
        for (const row of rows) {
          await db.links.update(row.id, { active });
        }
      }
    } else if (!existing && input.links !== undefined) {
      await replaceLinks(db, itemId, [], input.links, active);
    }

    if (input.private !== undefined) {
      const row = existing
        ? await db.itemPrivate.withIndex("by_item", (q) => q.eq("itemId", itemId)).first()
        : null;
      const privateChanged = await mergePrivate(
        row,
        input.private,
        (values) => db.itemPrivate.insert({ itemId, ...values }),
        (id, privatePatch) => db.itemPrivate.update(id, privatePatch)
      );
      if (privateChanged) changed = true;
    }

    if (Object.keys(patch).length > 0) changed = true;
    if (existing && changed) {
      await db.items.update(itemId, { ...patch, agentUpdatedAt: now });
    }

    const stageEvent = !previous || previous.stage !== next.stage || previous.outcome !== next.outcome;
    if (stageEvent) {
      await db.events.insert({
        key: `${AUTO_KEY_PREFIX}stage:${itemId}:${now}`,
        itemId,
        at: now,
        actor: "agent",
        type: "stage_changed",
        note: clip(input.stageNote ?? stageEventNote(previous, next), LIMITS.eventNote),
        isPublic: true
      });
    }

    results.push({
      slug: input.slug,
      id: itemId,
      status: !existing ? "created" : changed ? "updated" : "unchanged",
      stageEvent
    });
  }

  await touchSyncState(db, { lastAgentPushAt: now });
  const response: ItemsResponse = { ok: true, results };
  return json(response);
}

// ---------------------------------------------------------------------------
// POST /api/agent/asks
// ---------------------------------------------------------------------------

type SlugCache = Map<string, ItemRow | null>;

async function itemBySlug(db: ReadDb, cache: SlugCache, slug: string): Promise<ItemRow | null> {
  if (cache.has(slug)) return cache.get(slug) ?? null;
  const row = await db.items.withIndex("by_slug", (q) => q.eq("slug", slug)).first();
  cache.set(slug, row);
  return row;
}

type AskPlan = { input: ParsedAsk; existing: AskRow | null; item: ItemRow | null };

export async function handleAsks(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  const db = ctx.db as unknown as WriteDb;
  const now = Date.now();

  const { asks, issues } = parseAsksRequest(read.body, now);
  if (issues.length > 0) return validationFailed(issues);

  const slugs: SlugCache = new Map();
  const plans: AskPlan[] = [];
  for (const [index, input] of asks.entries()) {
    const path = `asks[${index}]`;
    const existing = await db.asks.withIndex("by_key", (q) => q.eq("key", input.key)).first();
    if (input.op === "close") {
      if (!existing) {
        issues.push({ path: `${path}.key`, message: `No ask has the key "${input.key}".` });
      }
      plans.push({ input, existing, item: null });
      continue;
    }
    const item = await itemBySlug(db, slugs, input.item);
    if (!item) {
      issues.push({ path: `${path}.item`, message: `No item has the slug "${input.item}".` });
    } else if (existing && existing.itemId !== item.id) {
      issues.push({ path: `${path}.key`, message: `The key "${input.key}" already belongs to an ask on another item.` });
    }
    plans.push({ input, existing, item });
  }
  if (issues.length > 0) return validationFailed(issues);

  const results: AsksResponse["results"] = [];
  for (const { input, existing, item } of plans) {
    if (input.op === "close") {
      const ask = existing as AskRow;
      if (!ask.isOpen) {
        results.push({ key: input.key, id: ask.id, status: "unchanged", open: false });
        continue;
      }
      const closedAt = input.closedAt ?? now;
      await db.asks.update(ask.id, {
        isOpen: false,
        closedAt,
        ...(input.resolution !== undefined ? { resolution: input.resolution } : {})
      });
      await db.events.insert({
        key: `${AUTO_KEY_PREFIX}ask:${ask.id}:closed`,
        itemId: ask.itemId,
        at: closedAt,
        actor: "agent",
        type: "ask_closed",
        note: clip(`${ASK_KIND_LABELS[ask.kind as AskKind]}: ${input.resolution ?? "closed"}`, LIMITS.eventNote),
        isPublic: true
      });
      results.push({ key: input.key, id: ask.id, status: "updated", open: false });
      continue;
    }

    const itemId = (item as ItemRow).id;
    let askId: string;
    let status: WriteStatus;
    let open: boolean;
    if (!existing) {
      const openedAt = input.openedAt ?? now;
      const row = await db.asks.insert({
        key: input.key,
        itemId,
        kind: input.kind,
        publicLabel: input.publicLabel,
        openedAt,
        isOpen: true
      });
      await db.events.insert({
        key: `${AUTO_KEY_PREFIX}ask:${row.id}:opened`,
        itemId,
        at: openedAt,
        actor: "agent",
        type: "ask_opened",
        note: clip(`${ASK_KIND_LABELS[input.kind]}: ${input.publicLabel}`, LIMITS.eventNote),
        isPublic: true
      });
      askId = row.id;
      status = "created";
      open = true;
    } else {
      // A repeated "open" edits the ask. It never reopens one that was closed.
      const patch: { kind?: string; publicLabel?: string; openedAt?: number } = {};
      if (existing.kind !== input.kind) patch.kind = input.kind;
      if (existing.publicLabel !== input.publicLabel) patch.publicLabel = input.publicLabel;
      if (input.openedAt !== undefined && existing.openedAt !== input.openedAt) patch.openedAt = input.openedAt;
      const edited = Object.keys(patch).length > 0;
      if (edited) await db.asks.update(existing.id, patch);
      askId = existing.id;
      status = edited ? "updated" : "unchanged";
      open = existing.isOpen;
    }

    if (input.private !== undefined) {
      const row = existing ? await db.askPrivate.withIndex("by_ask", (q) => q.eq("askId", askId)).first() : null;
      const privateChanged = await mergePrivate(
        row,
        input.private,
        (values) => db.askPrivate.insert({ askId, ...values }),
        (id, privatePatch) => db.askPrivate.update(id, privatePatch)
      );
      if (privateChanged && status === "unchanged") status = "updated";
    }
    results.push({ key: input.key, id: askId, status, open });
  }

  await touchSyncState(db, { lastAgentPushAt: now });
  const response: AsksResponse = { ok: true, results };
  return json(response);
}

// ---------------------------------------------------------------------------
// POST /api/agent/events
// ---------------------------------------------------------------------------

export async function handleEvents(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  const db = ctx.db as unknown as WriteDb;
  const now = Date.now();

  const { events, issues } = parseEventsRequest(read.body, now);
  if (issues.length > 0) return validationFailed(issues);

  const slugs: SlugCache = new Map();
  const plans: { existingId: string | null; itemId: string }[] = [];
  for (const [index, input] of events.entries()) {
    const path = `events[${index}]`;
    if (input.key.startsWith(AUTO_KEY_PREFIX)) {
      issues.push({ path: `${path}.key`, message: `Keys starting with "${AUTO_KEY_PREFIX}" are reserved for the server.` });
    }
    const item = await itemBySlug(db, slugs, input.item);
    if (!item) {
      issues.push({ path: `${path}.item`, message: `No item has the slug "${input.item}".` });
      continue;
    }
    const existing = await db.events.withIndex("by_key", (q) => q.eq("key", input.key)).first();
    if (existing && existing.itemId !== item.id) {
      issues.push({ path: `${path}.key`, message: `The key "${input.key}" already belongs to an event on another item.` });
    }
    plans.push({ existingId: existing?.id ?? null, itemId: item.id });
  }
  if (issues.length > 0) return validationFailed(issues);

  const results: EventsResponse["results"] = [];
  for (const [index, input] of events.entries()) {
    const plan = plans[index];
    if (!plan) continue;
    if (plan.existingId) {
      results.push({ key: input.key, id: plan.existingId, status: "exists" });
      continue;
    }
    const row = await db.events.insert({
      key: input.key,
      itemId: plan.itemId,
      at: input.at ?? now,
      actor: input.actor,
      type: input.type,
      note: input.note,
      isPublic: input.isPublic,
      ...(input.url !== undefined ? { url: input.url } : {})
    });
    results.push({ key: input.key, id: row.id, status: "created" });
  }

  await touchSyncState(db, { lastAgentPushAt: now });
  const response: EventsResponse = { ok: true, results };
  return json(response);
}

// ---------------------------------------------------------------------------
// GET /api/agent/export
// ---------------------------------------------------------------------------

/**
 * Returns every row of every table, public and private, one page at a time.
 * A handler may return at most 1,000 rows, so the caller follows `nextCursor`.
 * The cursor is "<table index>:<page cursor within that table>".
 */
export async function handleExport(ctx: QueryServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const db = ctx.db as unknown as ReadDb;

  let tableIndex = 0;
  let pageCursor: string | null = null;
  const cursor = req.query.get("cursor");
  if (cursor) {
    const separator = cursor.indexOf(":");
    tableIndex = Number(separator === -1 ? cursor : cursor.slice(0, separator));
    const rest = separator === -1 ? "" : cursor.slice(separator + 1);
    pageCursor = rest.length > 0 ? rest : null;
    if (!Number.isInteger(tableIndex) || tableIndex < 0 || tableIndex >= EXPORT_TABLES.length) {
      return apiError(400, "invalid_cursor", "The cursor is not one this endpoint returned.");
    }
  }

  const tables: ExportResponse["tables"] = {};
  let budget: number = LIMITS.exportRowsPerPage;
  let nextCursor: string | null = null;
  try {
    // One step per table at most. (Capsule server code has no while loops.)
    for (let step = 0; step < EXPORT_TABLES.length && tableIndex < EXPORT_TABLES.length; step += 1) {
      const name: ExportTable = EXPORT_TABLES[tableIndex] as ExportTable;
      const page = await db[name].withIndex("by_creation").paginate({ cursor: pageCursor, numItems: budget });
      tables[name] = page.page as Record<string, unknown>[];
      budget -= page.page.length;
      if (!page.isDone) {
        nextCursor = `${tableIndex}:${page.continueCursor ?? ""}`;
        break;
      }
      tableIndex += 1;
      pageCursor = null;
      if (budget <= 0 && tableIndex < EXPORT_TABLES.length) {
        nextCursor = `${tableIndex}:`;
        break;
      }
    }
  } catch (error) {
    if (cursor) {
      return apiError(400, "invalid_cursor", "The cursor is not valid any more. Start the export again without one.");
    }
    throw error;
  }

  const response: ExportResponse = { ok: true, exportedAt: Date.now(), tables, nextCursor };
  return json(response);
}
