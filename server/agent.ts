// Agent endpoints: bearer AGENT_SECRET. Agents write item state here and read it back.
//
// Each handler runs in one transaction. It validates the whole batch and reads
// what it needs before the first write, and returns 400 without writing when
// anything is wrong.

import { json, type EndpointRequest, type EndpointResponse, type QueryServerContext, type ServerContext } from "lakebed/server";
import {
  EXPORT_TABLES,
  type AssignNumbersResponse,
  type AsksResponse,
  type EventsDeleteResponse,
  type EventsResponse,
  type ExportResponse,
  type ExportTable,
  type ItemAgentEntry,
  type ItemAgentsResponse,
  type ItemsResponse,
  type LinksPatchResponse,
  type WatchlistLink,
  type WatchlistResponse,
  type WriteStatus
} from "../shared/api";
import {
  ASK_KIND_LABELS,
  LINK_ROLES,
  OUTCOME_LABELS,
  STAGE_LABELS,
  type AskKind,
  type GhState,
  type LinkKind,
  type LinkOwnership,
  type LinkRole,
  type Outcome,
  type Stage
} from "../shared/enums";
import { ITEM_ID_PREFIX, formatItemId, isItemNumber, itemIdOf, parseItemId } from "../shared/itemId";
import { CURSOR_PATTERN, LIMITS, SLUG_PATTERN } from "../shared/limits";
import { apiError, checkBearer } from "./auth";
import type { AskRow, ItemPrivateRow, ItemRow, LinkRow, ReadDb, SyncStateRow, WriteDb } from "./schema";
import {
  isObject,
  parseAsksRequest,
  parseEventsDeleteRequest,
  parseEventsRequest,
  parseItemsRequest,
  parseLinksPatchRequest,
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
    nextItemNumber?: number;
  },
  /** The one syncState row, when the caller has already read it. Saves the read here. */
  known?: SyncStateRow | null
): Promise<void> {
  const row = known !== undefined ? known : await db.syncState.withIndex("by_creation").first();
  // An agent write moves the revision, which lets an export detect a write between its pages.
  const bump = patch.lastAgentPushAt !== undefined;
  if (row) {
    await db.syncState.update(row.id, bump ? { ...patch, revision: (row.revision ?? 0) + 1 } : patch);
  } else {
    await db.syncState.insert(bump ? { ...patch, revision: 1 } : patch);
  }
}

// ---------------------------------------------------------------------------
// Item numbers
// ---------------------------------------------------------------------------

/**
 * The highest item number in use, or 0 when no item has one. One row is read:
 * in the by_number index an item with no number sorts last in descending order.
 */
async function highestItemNumber(db: ReadDb): Promise<number> {
  const top = await db.items.withIndex("by_number").order("desc").first();
  return top?.number ?? 0;
}

/**
 * The number the next new item gets. The counter on the syncState row only goes
 * up, so deleting an item does not free its number. The counter is never trusted
 * alone: the next number is also above the highest in use, so a missing or stale
 * counter cannot hand out a number twice.
 */
async function nextItemNumber(db: ReadDb, state: SyncStateRow | null): Promise<number> {
  return Math.max(state?.nextItemNumber ?? 1, (await highestItemNumber(db)) + 1);
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
    // "gb-12" as a slug would be read as the ID GB-12 wherever an item is looked up.
    const asId = parseItemId(input.slug);
    if (asId !== null) {
      issues.push({
        path: `${path}.slug`,
        message: `A slug must not have the form of an item ID (${formatItemId(asId)}). The server assigns IDs.`
      });
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

const SNAPSHOT_FIELDS = [
  "ghTitle",
  "ghCreatedAt",
  "ghState",
  "ghIsDraft",
  "ghMergedAt",
  "ghClosedAt",
  "ghCi",
  "ghReviewDecision",
  "ghLabels",
  "ghHeadSha",
  "ghLastActivityAt",
  "ghOtherActivityAt",
  "ghOtherActivityBy",
  "macroscopeVerdict",
  "syncedAt",
  "syncError"
] as const satisfies readonly (keyof LinkRow)[];

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
        syncDue: true,
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
    // A different repo or number is a different thread: the stored snapshot no longer describes it.
    const retargeted = row.repo !== link.repo || row.number !== link.number;
    if (retargeted && row.syncedAt !== undefined) {
      for (const field of SNAPSHOT_FIELDS) {
        if (row[field] !== undefined) patch[field] = null;
      }
    }
    const syncDue = active || retargeted || row.syncedAt === undefined;
    if (row.syncDue !== syncDue) patch.syncDue = syncDue;
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
  // New items take the next numbers, in the order they appear in the batch.
  let state: SyncStateRow | null | undefined;
  let nextNumber = 0;
  if (creates > 0 && issues.length === 0) {
    const count = await db.items.withIndex("by_creation").count();
    if (count + creates > LIMITS.maxItems) {
      issues.push({
        path: "items",
        message: `This would store ${count + creates} items. The dashboard holds at most ${LIMITS.maxItems}.`
      });
    }
    state = await db.syncState.withIndex("by_creation").first();
    nextNumber = await nextItemNumber(db, state);
  }
  if (issues.length > 0) return validationFailed(issues);

  const results: ItemsResponse["results"] = [];
  for (const { input, existing, next } of plans) {
    const previous = existing ? stateOf(existing) : null;
    const active = next.stage !== "closed";
    let changed = false;
    let itemId: string;
    // An existing item keeps the number it has, or none until the backfill gives it one.
    let number: number | null = existing?.number ?? null;

    if (!existing) {
      number = nextNumber;
      nextNumber += 1;
      const row = await db.items.insert({
        slug: input.slug,
        number,
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
          await db.links.update(row.id, { active, syncDue: active || row.syncedAt === undefined });
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
        // The key keeps the time of the request, so it stays unique; `at` is when the change happened.
        at: input.stageEventAt ?? now,
        actor: "agent",
        type: "stage_changed",
        note: clip(input.stageNote ?? stageEventNote(previous, next), LIMITS.eventNote),
        isPublic: true
      });
    }

    results.push({
      slug: input.slug,
      id: itemId,
      number,
      shortId: number === null ? null : formatItemId(number),
      status: !existing ? "created" : changed ? "updated" : "unchanged",
      stageEvent
    });
  }

  await touchSyncState(db, { lastAgentPushAt: now, ...(creates > 0 ? { nextItemNumber: nextNumber } : {}) }, state);
  const response: ItemsResponse = { ok: true, results };
  return json(response);
}

// ---------------------------------------------------------------------------
// POST /api/agent/items/assign-numbers
// ---------------------------------------------------------------------------

/**
 * Gives a number to every item that has none: the items stored before numbers
 * existed. Oldest find first (`foundAt`, ties by creation time), continuing
 * after the highest number in use. An item that has a number keeps it, so a
 * second run assigns nothing.
 *
 * One call reads every item in one scan and writes one row per item it numbers,
 * which is inside the write limit for a full dashboard. The 5-second transaction
 * limit is the tighter one, so a call numbers at most `limit` items and reports
 * how many remain. The order does not depend on where a call stops, so calling
 * again until `remaining` is 0 gives the same numbers as one call would.
 */
export async function handleAssignNumbers(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;

  // The body is optional: {} or nothing means the default limit.
  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim().length > 0) body = JSON.parse(text);
  } catch {
    return apiError(400, "invalid_json", "The request body is not valid JSON.");
  }
  const issues: Issues = [];
  let limit: number = LIMITS.assignNumbersPerCall;
  if (!isObject(body)) {
    issues.push({ path: "", message: "The body must be a JSON object, or empty." });
  } else {
    for (const key of Object.keys(body)) {
      if (key !== "limit") issues.push({ path: key, message: "Unknown field. Allowed fields: limit." });
    }
    if (body.limit !== undefined) {
      if (typeof body.limit === "number" && Number.isInteger(body.limit) && body.limit >= 1 && body.limit <= LIMITS.maxItems) {
        limit = body.limit;
      } else {
        issues.push({ path: "limit", message: `Must be a whole number from 1 to ${LIMITS.maxItems}.` });
      }
    }
  }
  if (issues.length > 0) return validationFailed(issues);

  const db = ctx.db as unknown as WriteDb;
  const now = Date.now();

  // Read everything before the first write. Two index scans, whatever the item count.
  const rows = await db.items.withIndex("by_creation").take(LIMITS.maxItems);
  const state = await db.syncState.withIndex("by_creation").first();

  let highest = 0;
  const unnumbered: ItemRow[] = [];
  for (const row of rows) {
    if (isItemNumber(row.number)) highest = Math.max(highest, row.number);
    else unnumbered.push(row);
  }
  // The rows arrive in creation order and the sort is stable, so equal `foundAt` keeps creation order.
  unnumbered.sort((a, b) => a.foundAt - b.foundAt);
  let next = Math.max(state?.nextItemNumber ?? 1, highest + 1);

  const assigned: AssignNumbersResponse["assigned"] = [];
  for (const row of unnumbered.slice(0, limit)) {
    await db.items.update(row.id, { number: next });
    assigned.push({ slug: row.slug, id: row.id, number: next, shortId: formatItemId(next) });
    next += 1;
  }
  // Nothing to number means nothing to write: a repeated run leaves the revision alone.
  if (assigned.length > 0) {
    await touchSyncState(db, { lastAgentPushAt: now, nextItemNumber: next }, state);
  } else if ((state?.nextItemNumber ?? 0) < next) {
    // Every item has a number but the stored counter is missing or behind. Store the right one.
    await touchSyncState(db, { nextItemNumber: next }, state);
  }

  const response: AssignNumbersResponse = {
    ok: true,
    assigned,
    remaining: unnumbered.length - assigned.length,
    nextNumber: next
  };
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
// POST /api/agent/events/delete
// ---------------------------------------------------------------------------

// Keys are unique by construction, not by a constraint, so a key is read as a short list.
const MAX_EVENTS_PER_KEY = 5;

/**
 * Removes events by key, the server's own "auto:" events included. A key that
 * names no event is reported in its result and is not an error, so a retry of
 * a request that already ran succeeds.
 */
export async function handleDeleteEvents(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  const db = ctx.db as unknown as WriteDb;

  const { keys, issues } = parseEventsDeleteRequest(read.body);
  if (issues.length > 0) return validationFailed(issues);

  // Read everything before the first write.
  const found: string[][] = [];
  for (const key of keys) {
    const rows = await db.events.withIndex("by_key", (q) => q.eq("key", key)).take(MAX_EVENTS_PER_KEY);
    found.push(rows.map((row) => row.id));
  }

  const results: EventsDeleteResponse["results"] = [];
  let deleted = 0;
  for (const [index, key] of keys.entries()) {
    const ids = found[index] ?? [];
    for (const id of ids) await db.events.delete(id);
    deleted += ids.length;
    results.push({ key, status: ids.length > 0 ? "deleted" : "not_found" });
  }

  await touchSyncState(db, { lastAgentPushAt: Date.now() });
  const response: EventsDeleteResponse = { ok: true, deleted, results };
  return json(response);
}

// ---------------------------------------------------------------------------
// POST /api/agent/links
// ---------------------------------------------------------------------------

/**
 * Sets the triage fields of links found by URL, leaving every other link of
 * their items alone. A URL can sit on more than one item; every copy is patched.
 */
export async function handlePatchLinks(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  const db = ctx.db as unknown as WriteDb;
  const now = Date.now();

  const { links, issues } = parseLinksPatchRequest(read.body);
  if (issues.length > 0) return validationFailed(issues);

  // Read everything before the first write.
  const matches: LinkRow[][] = [];
  for (const [index, input] of links.entries()) {
    const rows = await db.links.withIndex("by_url", (q) => q.eq("url", input.url)).take(LIMITS.linkMatchesPerUrl + 1);
    if (rows.length > LIMITS.linkMatchesPerUrl) {
      issues.push({
        path: `links[${index}].url`,
        message: `More than ${LIMITS.linkMatchesPerUrl} items carry this URL, which is more than one request can patch. Set it through each item instead.`
      });
    }
    matches.push(rows);
  }
  if (issues.length > 0) return validationFailed(issues);

  const results: LinksPatchResponse["results"] = [];
  const touchedItems = new Set<string>();
  for (const [index, input] of links.entries()) {
    const rows = matches[index] ?? [];
    let updated = false;
    for (const row of rows) {
      const patch: { triageBucket?: string | null; triageRank?: number | null } = {};
      if (input.triageBucket !== undefined && (row.triageBucket ?? null) !== input.triageBucket) {
        patch.triageBucket = input.triageBucket;
      }
      if (input.triageRank !== undefined && (row.triageRank ?? null) !== input.triageRank) {
        patch.triageRank = input.triageRank;
      }
      if (Object.keys(patch).length === 0) continue;
      await db.links.update(row.id, patch);
      touchedItems.add(row.itemId);
      updated = true;
    }
    results.push({
      url: input.url,
      status: rows.length === 0 ? "not_found" : updated ? "updated" : "unchanged",
      matched: rows.length
    });
  }
  // As with an upsert that changes a link: the item's "last updated" moves.
  for (const itemId of touchedItems) {
    await db.items.update(itemId, { agentUpdatedAt: now });
  }

  await touchSyncState(db, { lastAgentPushAt: now });
  const response: LinksPatchResponse = { ok: true, results };
  return json(response);
}

// ---------------------------------------------------------------------------
// POST /api/agent/items/delete
// ---------------------------------------------------------------------------

// One index scan per ask for its private row, and a handler may make 100 scans.
const DELETE_MAX_ASKS = 45;
const DELETE_MAX_EVENTS = 800;

/**
 * Removes one item with its links, asks, events and private rows. It is for
 * mistakes, such as a wrong slug or a duplicate. An item that ran its course
 * is closed with an outcome, not deleted. The body repeats the slug in
 * `confirm` so a stray call cannot delete anything.
 */
export async function handleDeleteItem(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const read = await readBody(req);
  if (!read.ok) return read.response;
  const body = read.body as { slug?: unknown; confirm?: unknown } | null;
  const slug = body && typeof body === "object" ? body.slug : undefined;
  if (typeof slug !== "string" || !SLUG_PATTERN.test(slug) || body?.confirm !== slug) {
    return apiError(400, "validation_failed", 'Send {"slug": "<slug>", "confirm": "<the same slug>"}. Nothing was deleted.');
  }
  const db = ctx.db as unknown as WriteDb;
  const item = await db.items.withIndex("by_slug", (q) => q.eq("slug", slug)).first();
  if (!item) {
    return apiError(404, "not_found", `No item has the slug "${slug}".`);
  }

  // Read everything before the first write.
  const links = await db.links.withIndex("by_item", (q) => q.eq("itemId", item.id)).take(LIMITS.linksPerItem * 2);
  const asks = await db.asks.withIndex("by_item", (q) => q.eq("itemId", item.id)).take(DELETE_MAX_ASKS + 1);
  const events = await db.events.withIndex("by_item", (q) => q.eq("itemId", item.id)).take(DELETE_MAX_EVENTS + 1);
  if (asks.length > DELETE_MAX_ASKS || events.length > DELETE_MAX_EVENTS) {
    return apiError(
      409,
      "too_large",
      `This item has more history than one request can delete (over ${DELETE_MAX_ASKS} asks or ${DELETE_MAX_EVENTS} events). Close it with an outcome instead.`
    );
  }
  const privateRows = await db.itemPrivate.withIndex("by_item", (q) => q.eq("itemId", item.id)).take(5);
  const askPrivateIds: string[] = [];
  for (const ask of asks) {
    const rows = await db.askPrivate.withIndex("by_ask", (q) => q.eq("askId", ask.id)).take(5);
    for (const row of rows) askPrivateIds.push(row.id);
  }

  for (const id of askPrivateIds) await db.askPrivate.delete(id);
  for (const row of privateRows) await db.itemPrivate.delete(row.id);
  for (const row of events) await db.events.delete(row.id);
  for (const row of asks) await db.asks.delete(row.id);
  for (const row of links) await db.links.delete(row.id);
  await db.items.delete(item.id);
  await touchSyncState(db, { lastAgentPushAt: Date.now() });

  return json({
    ok: true,
    deleted: { slug, links: links.length, asks: asks.length, events: events.length }
  });
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
    if (
      !Number.isInteger(tableIndex) ||
      tableIndex < 0 ||
      tableIndex >= EXPORT_TABLES.length ||
      (pageCursor !== null && !CURSOR_PATTERN.test(pageCursor))
    ) {
      return apiError(400, "invalid_cursor", "The cursor is not one this endpoint returned.");
    }
  }

  const tables: ExportResponse["tables"] = {};
  let budget: number = LIMITS.exportRowsPerPage;
  let nextCursor: string | null = null;
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

  const state = await db.syncState.withIndex("by_creation").first();
  const response: ExportResponse = {
    ok: true,
    exportedAt: Date.now(),
    revision: state?.revision ?? 0,
    itemIdPrefix: ITEM_ID_PREFIX,
    tables,
    nextCursor
  };
  return json(response);
}

// ---------------------------------------------------------------------------
// GET /api/agent/item-agents
// ---------------------------------------------------------------------------

/**
 * Every item that is not closed, with the agent that owns it. This is how a
 * watcher finds whom to tell about an item, and how a dispatcher finds the
 * items nobody owns. Two reads: the items (at most LIMITS.maxItems) and the
 * private rows, with the rest of a handler's 1,000 rows as headroom in case
 * the private table ever holds a stray or duplicate row.
 */
export async function handleItemAgents(ctx: QueryServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const db = ctx.db as unknown as ReadDb;

  const items = await db.items.withIndex("by_creation").take(LIMITS.maxItems);
  const privateCap = 1000 - LIMITS.maxItems;
  const privateRows = await db.itemPrivate.withIndex("by_creation").take(privateCap);
  // The oldest row wins, as it does where the owner view and the upsert read one item's row.
  const privateByItem = new Map<string, ItemPrivateRow>();
  for (const row of privateRows) {
    if (!privateByItem.has(row.itemId)) privateByItem.set(row.itemId, row);
  }

  const entries: ItemAgentEntry[] = [];
  let unassigned = 0;
  for (const item of items) {
    if (item.stage === "closed") continue;
    const owner = privateByItem.get(item.id);
    const agentName = owner?.agentName ?? null;
    const agentAddress = owner?.agentAddress ?? null;
    if (agentAddress === null) unassigned += 1;
    entries.push({
      itemSlug: item.slug,
      itemNumber: isItemNumber(item.number) ? item.number : null,
      itemShortId: itemIdOf(item),
      itemStage: item.stage as Stage,
      agentName,
      agentAddress
    });
  }
  entries.sort((left, right) => (left.itemNumber ?? Infinity) - (right.itemNumber ?? Infinity));

  const response: ItemAgentsResponse = {
    ok: true,
    generatedAt: Date.now(),
    unassigned,
    // True only if the private table held more rows than one read can take. An
    // item may then show no agent when it has one, so do not dispatch on this answer.
    incomplete: privateRows.length >= privateCap,
    items: entries
  };
  return json(response);
}

// ---------------------------------------------------------------------------
// GET /api/agent/watchlist
// ---------------------------------------------------------------------------

/**
 * Every link on an item that is not closed: the threads worth polling.
 * Links are read one role at a time through the (role, active) index, so no
 * closed item's link is read. The cursor is "<role index>:<page cursor within that role>".
 */
export async function handleWatchlist(ctx: QueryServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const db = ctx.db as unknown as ReadDb;

  let roleIndex = 0;
  let pageCursor: string | null = null;
  const cursor = req.query.get("cursor");
  if (cursor) {
    const separator = cursor.indexOf(":");
    roleIndex = Number(separator === -1 ? cursor : cursor.slice(0, separator));
    const rest = separator === -1 ? "" : cursor.slice(separator + 1);
    pageCursor = rest.length > 0 ? rest : null;
    if (
      !Number.isInteger(roleIndex) ||
      roleIndex < 0 ||
      roleIndex >= LINK_ROLES.length ||
      (pageCursor !== null && !CURSOR_PATTERN.test(pageCursor))
    ) {
      return apiError(400, "invalid_cursor", "The cursor is not one this endpoint returned.");
    }
  }

  const rows: LinkRow[] = [];
  let budget: number = LIMITS.watchlistLinksPerPage;
  let nextCursor: string | null = null;
  // One step per role at most. (Capsule server code has no while loops.)
  for (let step = 0; step < LINK_ROLES.length && roleIndex < LINK_ROLES.length; step += 1) {
    const role: LinkRole = LINK_ROLES[roleIndex] as LinkRole;
    const page = await db.links
      .withIndex("by_role_active", (q) => q.eq("role", role).eq("active", true))
      .paginate({ cursor: pageCursor, numItems: budget });
    rows.push(...page.page);
    budget -= page.page.length;
    if (!page.isDone) {
      nextCursor = `${roleIndex}:${page.continueCursor ?? ""}`;
      break;
    }
    roleIndex += 1;
    pageCursor = null;
    if (budget <= 0 && roleIndex < LINK_ROLES.length) {
      nextCursor = `${roleIndex}:`;
      break;
    }
  }

  const items = await db.items.withIndex("by_creation").take(LIMITS.maxItems);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const links: WatchlistLink[] = [];
  for (const row of rows) {
    const item = itemById.get(row.itemId);
    // `active` is kept in step with the item's stage on every write. The stage is checked all the same.
    if (!item || item.stage === "closed") continue;
    links.push({
      url: row.url,
      repo: row.repo,
      number: row.number,
      kind: row.kind as LinkKind,
      ownership: row.ownership as LinkOwnership,
      role: row.role as LinkRole,
      itemSlug: item.slug,
      itemNumber: item.number ?? null,
      itemShortId: itemIdOf(item),
      itemStage: item.stage as Stage,
      ghState: (row.ghState as GhState | undefined) ?? null,
      lastOtherActivityAt: row.ghOtherActivityAt ?? null,
      syncedAt: row.syncedAt ?? null
    });
  }

  const state = await db.syncState.withIndex("by_creation").first();
  const response: WatchlistResponse = {
    ok: true,
    generatedAt: Date.now(),
    revision: state?.revision ?? 0,
    links,
    nextCursor
  };
  return json(response);
}
