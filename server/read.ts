// Read paths shared by the public queries and the owner queries.
//
// Everything here takes a PublicDb, which has no private tables. `full` decides
// whether a non-public item is shown as itself (owner) or as an undisclosed
// candidate (everyone else). The public queries in index.ts always pass false.

import type {
  AskView,
  EventView,
  ItemRef,
  ItemView,
  LinkView,
  OverviewView,
  OwnerItemView,
  SyncView
} from "../shared/api";
import {
  OUTCOMES,
  STAGES,
  UNDISCLOSED_TITLE,
  WAITING_ON,
  type AskKind,
  type EventActor,
  type EventType,
  type FollowUpState,
  type GhCi,
  type GhReviewDecision,
  type GhState,
  type LinkKind,
  type LinkOwnership,
  type LinkRole,
  type Outcome,
  type Route,
  type Stage,
  type WaitingOn
} from "../shared/enums";
import { LIMITS, SLUG_PATTERN } from "../shared/limits";
import type { AskRow, EventRow, ItemRow, LinkRow, PublicDb, SyncStateRow } from "./schema";

const MAX_OPEN_ASKS = 200;
const MAX_ASKS_PER_ITEM = 100;
const MAX_EVENTS_PER_ITEM = 300;

function lines(value: string | undefined): string[] {
  return value ? value.split("\n").filter((line) => line.length > 0) : [];
}

export function linkView(row: LinkRow): LinkView {
  return {
    id: row.id,
    repo: row.repo,
    number: row.number,
    url: row.url,
    kind: row.kind as LinkKind,
    ownership: row.ownership as LinkOwnership,
    role: row.role as LinkRole,
    title: row.ghTitle ?? null,
    state: (row.ghState as GhState | undefined) ?? null,
    createdAt: row.ghCreatedAt ?? null,
    isDraft: row.ghIsDraft ?? null,
    mergedAt: row.ghMergedAt ?? null,
    closedAt: row.ghClosedAt ?? null,
    ci: (row.ghCi as GhCi | undefined) ?? null,
    reviewDecision: (row.ghReviewDecision as GhReviewDecision | undefined) ?? null,
    labels: lines(row.ghLabels),
    headSha: row.ghHeadSha ?? null,
    macroscopeVerdict: row.macroscopeVerdict ?? null,
    lastActivityAt: row.ghLastActivityAt ?? null,
    lastOtherActivityAt: row.ghOtherActivityAt ?? null,
    lastOtherActivityBy: row.ghOtherActivityBy ?? null,
    triageBucket: row.triageBucket ?? null,
    triageRank: row.triageRank ?? null,
    syncedAt: row.syncedAt ?? null,
    syncError: row.syncError ?? null
  };
}

/** What anyone may know about an item that is not public: stage, waiting-on and dates. */
function undisclosedItemView(row: ItemRow): ItemView {
  return {
    id: row.id,
    disclosed: false,
    slug: null,
    title: UNDISCLOSED_TITLE,
    stage: row.stage as Stage,
    waitingOn: row.waitingOn as WaitingOn,
    waitingSince: row.waitingSince,
    foundAt: row.foundAt,
    updatedAt: row.agentUpdatedAt,
    summary: null,
    route: null,
    routeReason: null,
    outcome: null,
    closedAt: null,
    targetRepo: null,
    originRefs: [],
    lastValidatedAt: null,
    lastValidatedSha: null,
    validationVerdict: null,
    followUpState: null,
    followUpNote: null,
    upstreamChangedAt: null,
    upstreamChangeNote: null,
    primaryLink: null,
    dependencyLinks: []
  };
}

function disclosedItemView(row: ItemRow, primary: LinkRow | null, dependencies: readonly LinkRow[]): ItemView {
  return {
    id: row.id,
    disclosed: true,
    slug: row.slug,
    title: row.title,
    stage: row.stage as Stage,
    waitingOn: row.waitingOn as WaitingOn,
    waitingSince: row.waitingSince,
    foundAt: row.foundAt,
    updatedAt: row.agentUpdatedAt,
    summary: row.summary,
    route: (row.route as Route | undefined) ?? null,
    routeReason: row.routeReason ?? null,
    outcome: (row.outcome as Outcome | undefined) ?? null,
    closedAt: row.closedAt ?? null,
    targetRepo: row.targetRepo,
    originRefs: lines(row.originRefs),
    lastValidatedAt: row.lastValidatedAt ?? null,
    lastValidatedSha: row.lastValidatedSha ?? null,
    validationVerdict: row.validationVerdict ?? null,
    followUpState: row.followUpState as FollowUpState,
    followUpNote: row.followUpNote ?? null,
    upstreamChangedAt: row.upstreamChangedAt ?? null,
    upstreamChangeNote: row.upstreamChangeNote ?? null,
    primaryLink: primary ? linkView(primary) : null,
    dependencyLinks: dependencies.map(linkView)
  };
}

export function itemView(row: ItemRow, primary: LinkRow | null, dependencies: readonly LinkRow[], full: boolean): ItemView {
  return full || row.isPublic ? disclosedItemView(row, primary, dependencies) : undisclosedItemView(row);
}

export function ownerItemView(row: ItemRow, primary: LinkRow | null, dependencies: readonly LinkRow[]): OwnerItemView {
  return { ...disclosedItemView(row, primary, dependencies), isPublic: row.isPublic };
}

/** The base and covering links among an item's links. */
export function dependenciesOf(links: readonly LinkRow[]): LinkRow[] {
  return links.filter((link) => link.role === "base" || link.role === "covering");
}

function itemRef(row: ItemRow, full: boolean): ItemRef {
  const disclosed = full || row.isPublic;
  return {
    id: row.id,
    disclosed,
    slug: disclosed ? row.slug : null,
    title: disclosed ? row.title : UNDISCLOSED_TITLE,
    stage: row.stage as Stage
  };
}

export function askView(row: AskRow, item: ItemRow, full: boolean): AskView {
  const disclosed = full || item.isPublic;
  return {
    id: row.id,
    kind: row.kind as AskKind,
    label: disclosed ? row.publicLabel : null,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? null,
    resolution: disclosed ? (row.resolution ?? null) : null,
    item: itemRef(item, full)
  };
}

export function eventView(row: EventRow): EventView {
  return {
    id: row.id,
    at: row.at,
    actor: row.actor as EventActor,
    type: row.type as EventType,
    note: row.note,
    url: row.url ?? null,
    isPublic: row.isPublic
  };
}

export function syncView(row: SyncStateRow | null): SyncView {
  return {
    lastGithubSyncAt: row?.lastGithubSyncAt ?? null,
    lastGithubOkAt: row?.lastGithubOkAt ?? null,
    lastAgentPushAt: row?.lastAgentPushAt ?? null,
    lastError: row?.lastError ?? null,
    lastErrorAt: row?.lastErrorAt ?? null
  };
}

export type OverviewData = { view: OverviewView; openAskRows: AskRow[] };

export async function readOverview(db: PublicDb, full: boolean): Promise<OverviewData> {
  const items = await db.items.withIndex("by_creation").take(LIMITS.maxItems);
  const openAskRows = await db.asks.withIndex("by_open", (q) => q.eq("isOpen", true)).take(MAX_OPEN_ASKS);
  const sync = await db.syncState.withIndex("by_creation").first();

  const byId = new Map<string, ItemRow>();
  const stageCounts = new Map<string, number>();
  const waitingCounts = new Map<string, number>();
  const outcomeCounts = new Map<string, number>();
  let undisclosed = 0;
  let followUpsOwed = 0;
  let upstreamChanged = 0;

  for (const item of items) {
    byId.set(item.id, item);
    stageCounts.set(item.stage, (stageCounts.get(item.stage) ?? 0) + 1);
    // Stage and waiting-on are countable for every item. Outcome, follow-up and the
    // upstream marker are not: for a non-public item they would reveal hidden state.
    const countable = full || item.isPublic;
    if (item.stage === "closed") {
      if (item.outcome && countable) {
        outcomeCounts.set(item.outcome, (outcomeCounts.get(item.outcome) ?? 0) + 1);
      }
    } else {
      waitingCounts.set(item.waitingOn, (waitingCounts.get(item.waitingOn) ?? 0) + 1);
    }
    if (!item.isPublic) undisclosed += 1;
    if (countable && item.followUpState === "owed") followUpsOwed += 1;
    if (countable && item.upstreamChangedAt !== undefined) upstreamChanged += 1;
  }

  const openAsks: AskView[] = [];
  const keptRows: AskRow[] = [];
  for (const ask of openAskRows) {
    const item = byId.get(ask.itemId);
    if (!item) continue;
    openAsks.push(askView(ask, item, full));
    keptRows.push(ask);
  }

  const closed = stageCounts.get("closed") ?? 0;
  const view: OverviewView = {
    generatedAt: Date.now(),
    stats: {
      total: items.length,
      inProgress: items.length - closed,
      offered: stageCounts.get("offered") ?? 0,
      closed,
      merged: outcomeCounts.get("merged") ?? 0,
      undisclosed,
      openAsks: openAsks.length,
      followUpsOwed,
      upstreamChanged
    },
    pipeline: STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
    waiting: WAITING_ON.map((waitingOn) => ({ waitingOn, count: waitingCounts.get(waitingOn) ?? 0 })),
    outcomes: OUTCOMES.map((outcome) => ({ outcome, count: outcomeCounts.get(outcome) ?? 0 })),
    openAsks,
    sync: syncView(sync)
  };
  return { view, openAskRows: keptRows };
}

export type ItemListData = {
  rows: ItemRow[];
  primaryByItem: Map<string, LinkRow>;
  dependenciesByItem: Map<string, LinkRow[]>;
};



export async function readItemRows(db: PublicDb): Promise<ItemListData> {
  const rows = await db.items.withIndex("by_creation").take(LIMITS.maxItems);
  // At most one primary link per item, so this stays within the row budget.
  const primaries = await db.links.withIndex("by_role", (q) => q.eq("role", "primary")).take(LIMITS.maxItems);
  const primaryByItem = new Map<string, LinkRow>();
  for (const link of primaries) {
    primaryByItem.set(link.itemId, link);
  }
  const dependenciesByItem = new Map<string, LinkRow[]>();
  for (const role of ["base", "covering"] as const) {
    // Only links on items that are not closed. A closed item's dependencies are
    // history, shown on its own page, and would otherwise fill the cap over time.
    const links = await db.links
      .withIndex("by_role_active", (q) => q.eq("role", role).eq("active", true))
      .take(LIMITS.maxOpenDependencyLinksPerRole);
    for (const link of links) {
      const list = dependenciesByItem.get(link.itemId);
      if (list) list.push(link);
      else dependenciesByItem.set(link.itemId, [link]);
    }
  }
  return { rows, primaryByItem, dependenciesByItem };
}

export async function readItemList(db: PublicDb, full: boolean): Promise<ItemView[]> {
  const { rows, primaryByItem, dependenciesByItem } = await readItemRows(db);
  return rows.map((row) => itemView(row, primaryByItem.get(row.id) ?? null, dependenciesByItem.get(row.id) ?? [], full));
}

export type ItemDetailData = {
  row: ItemRow;
  links: LinkRow[];
  asks: AskRow[];
  events: EventRow[];
};

/**
 * Finds an item by slug or by row id.
 *
 * A slug finds only an item the caller may see in full, so that guessing the
 * slug of a non-public item does not confirm it exists. The row id finds any
 * item; the caller then decides what to show.
 */
export async function findItem(db: PublicDb, ref: string, full: boolean): Promise<ItemRow | null> {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 200) {
    return null;
  }
  if (SLUG_PATTERN.test(ref)) {
    const bySlug = await db.items.withIndex("by_slug", (q) => q.eq("slug", ref)).first();
    if (bySlug) {
      return full || bySlug.isPublic ? bySlug : null;
    }
  }
  try {
    return await db.items.get(ref);
  } catch {
    return null;
  }
}

export async function readItemDetail(db: PublicDb, ref: string, full: boolean): Promise<ItemDetailData | null> {
  const row = await findItem(db, ref, full);
  if (!row) {
    return null;
  }
  const disclosed = full || row.isPublic;
  // Newest first, so a cap drops the oldest history, never a new open ask.
  const asks = await db.asks
    .withIndex("by_item", (q) => q.eq("itemId", row.id))
    .order("desc")
    .take(MAX_ASKS_PER_ITEM);
  if (!disclosed) {
    // Links and events of an undisclosed item are not read at all.
    return { row, links: [], asks, events: [] };
  }
  const links = await db.links.withIndex("by_item", (q) => q.eq("itemId", row.id)).take(LIMITS.linksPerItem);
  // The public reader asks the index for public events, so private ones cannot crowd them out of the cap.
  const events = full
    ? await db.events
        .withIndex("by_item", (q) => q.eq("itemId", row.id))
        .order("desc")
        .take(MAX_EVENTS_PER_ITEM)
    : await db.events
        .withIndex("by_item_public", (q) => q.eq("itemId", row.id).eq("isPublic", true))
        .order("desc")
        .take(MAX_EVENTS_PER_ITEM);
  return { row, links, asks, events };
}
