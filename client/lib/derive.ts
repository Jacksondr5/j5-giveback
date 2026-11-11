// Derivations over query results: sorting, grouping and the overview statistics.
// Pure functions of their arguments, so they can be checked without a browser.

import type { AskPrivateView, AskView, ItemView, LinkView, SyncView } from "../../shared/api";
import { STAGES, type Stage } from "../../shared/enums";
import { HOUR } from "./format";

/** An item as either the public query or the owner query returns it. */
export type ListItem = ItemView & { isPublic?: boolean };
/** An ask as either the public query or the owner query returns it. */
export type ListAsk = AskView & { private?: AskPrivateView | null };

const STAGE_ORDER = new Map<Stage, number>(STAGES.map((stage, index) => [stage, index]));

function stageIndex(stage: Stage): number {
  return STAGE_ORDER.get(stage) ?? STAGES.length;
}

// ---------------------------------------------------------------------------
// Offered upstream: quietest first
// ---------------------------------------------------------------------------

export type Quiet = {
  /** When the thread last heard from someone other than Jackson, or when the wait began if it never has. */
  since: number;
  /** False when nobody but Jackson has commented or reviewed yet. */
  replied: boolean;
  by: string | null;
};

/**
 * How long an offered item has been quiet. "Quiet" counts from the last comment
 * or review by someone other than Jackson, bots excluded, which the server reads
 * from GitHub. When there has been none, it counts from when the current wait began.
 */
export function quietState(item: ListItem): Quiet {
  const link = item.primaryLink;
  if (link && link.lastOtherActivityAt !== null) {
    return { since: link.lastOtherActivityAt, replied: true, by: link.lastOtherActivityBy };
  }
  return { since: item.waitingSince, replied: false, by: null };
}

/** Items in the Offered stage, longest-quiet first. Ties keep the older item first. */
export function offeredQuietestFirst(items: readonly ListItem[]): ListItem[] {
  return items
    .filter((item) => item.stage === "offered")
    .sort((a, b) => quietState(a).since - quietState(b).since || a.foundAt - b.foundAt);
}

// ---------------------------------------------------------------------------
// Candidates and closed items
// ---------------------------------------------------------------------------

const CANDIDATE_STAGES: readonly Stage[] = ["found", "validating", "deciding"];

/** Items not yet routed: Deciding first, then Validating, then Found; oldest first within a stage. */
export function candidates(items: readonly ListItem[]): ListItem[] {
  return items
    .filter((item) => CANDIDATE_STAGES.includes(item.stage))
    .sort((a, b) => stageIndex(b.stage) - stageIndex(a.stage) || a.foundAt - b.foundAt);
}

/** When a closed item closed. An undisclosed item hides its close date, so its last update stands in. */
export function closedTime(item: ListItem): number {
  return item.closedAt ?? item.updatedAt;
}

/** The most recently closed items, newest first. */
export function recentlyClosed(items: readonly ListItem[], limit: number): ListItem[] {
  return items
    .filter((item) => item.stage === "closed")
    .sort((a, b) => closedTime(b) - closedTime(a))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Our move
// ---------------------------------------------------------------------------

export type Move = {
  item: ListItem;
  /** "upstream_changed": the refresh saw a link merge, close, reopen or start failing CI. "agent": waiting on the giveback agent. */
  reason: "upstream_changed" | "agent";
  since: number;
};

/**
 * Open items where the next step is on the J5 side: the server raised its
 * upstream-changed marker, or the item waits on the giveback agent.
 * Upstream changes come first, and the longest-waiting first within each group.
 */
export function ourMove(items: readonly ListItem[]): Move[] {
  const moves: Move[] = [];
  for (const item of items) {
    if (item.stage === "closed") continue;
    if (item.upstreamChangedAt !== null) {
      moves.push({ item, reason: "upstream_changed", since: item.upstreamChangedAt });
    } else if (item.waitingOn === "giveback_agent") {
      moves.push({ item, reason: "agent", since: item.waitingSince });
    }
  }
  return moves.sort(
    (a, b) => Number(b.reason === "upstream_changed") - Number(a.reason === "upstream_changed") || a.since - b.since
  );
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** The median of the values, or null when there are none. An even count averages the middle two. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) return null;
  if (sorted.length % 2 === 1) return upper;
  const lower = sorted[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

/** When a merged item's change landed: GitHub's merge time, or the item's close time until the first sync. */
export function mergedTime(item: ListItem): number | null {
  if (item.outcome !== "merged") return null;
  return item.primaryLink?.mergedAt ?? item.closedAt;
}

/**
 * Median time from an item being found to its change merging upstream, over
 * disclosed items with the outcome "merged". An item whose merge time is before
 * its found time is left out: the dates cannot both be right.
 *
 * The server does not yet store when a PR was opened, so this is not the
 * "PR opened to merged" time. See `mergeStart`.
 */
export function medianTimeToMerge(items: readonly ListItem[]): { medianMs: number | null; count: number } {
  const spans: number[] = [];
  for (const item of items) {
    const end = mergedTime(item);
    if (end === null) continue;
    const span = end - mergeStart(item);
    if (span >= 0) spans.push(span);
  }
  return { medianMs: median(spans), count: spans.length };
}

/** Where the time-to-merge clock starts. The one place to change when the server stores a PR's open time. */
export function mergeStart(item: ListItem): number {
  return item.foundAt;
}

// ---------------------------------------------------------------------------
// Asks
// ---------------------------------------------------------------------------

/** Open asks first-opened first. The server already sorts them; this makes the client independent of that. */
export function asksOldestFirst<T extends AskView>(asks: readonly T[]): T[] {
  return [...asks].sort((a, b) => a.openedAt - b.openedAt);
}

/** The open asks of each item, keyed by item id, oldest first. */
export function openAsksByItem<T extends AskView>(asks: readonly T[]): Map<string, T[]> {
  const byItem = new Map<string, T[]>();
  for (const ask of asksOldestFirst(asks)) {
    if (ask.closedAt !== null) continue;
    const list = byItem.get(ask.item.id);
    if (list) list.push(ask);
    else byItem.set(ask.item.id, [ask]);
  }
  return byItem;
}

/** Open asks oldest first, then closed asks most recently closed first. */
export function asksForItem<T extends AskView>(asks: readonly T[]): { open: T[]; closed: T[] } {
  const open = asksOldestFirst(asks.filter((ask) => ask.closedAt === null));
  const closed = asks
    .filter((ask) => ask.closedAt !== null)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  return { open, closed };
}

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

export const SYNC_STALE_AFTER = HOUR;

export type SyncStatus =
  | { kind: "never" }
  | { kind: "failed"; failedAt: number | null; lastOkAt: number | null; error: string }
  | { kind: "stale"; lastOkAt: number }
  | { kind: "ok"; lastOkAt: number };

/**
 * What to say about the GitHub snapshot. A failed last run wins over staleness,
 * because it explains it. "Stale" means the last good run is more than an hour old.
 */
export function syncStatus(sync: SyncView, now: number): SyncStatus {
  if (sync.lastError !== null) {
    return {
      kind: "failed",
      failedAt: sync.lastErrorAt ?? sync.lastGithubSyncAt,
      lastOkAt: sync.lastGithubOkAt,
      error: sync.lastError
    };
  }
  if (sync.lastGithubOkAt === null) return { kind: "never" };
  if (now - sync.lastGithubOkAt > SYNC_STALE_AFTER) return { kind: "stale", lastOkAt: sync.lastGithubOkAt };
  return { kind: "ok", lastOkAt: sync.lastGithubOkAt };
}

// ---------------------------------------------------------------------------
// The item list
// ---------------------------------------------------------------------------

/** Pipeline order, and the oldest item first within a stage; closed items most recently closed first. */
export function sortForList(items: readonly ListItem[]): ListItem[] {
  return [...items].sort((a, b) => {
    const byStage = stageIndex(a.stage) - stageIndex(b.stage);
    if (byStage !== 0) return byStage;
    if (a.stage === "closed") return closedTime(b) - closedTime(a);
    return a.foundAt - b.foundAt;
  });
}

/** The distinct target repositories of the disclosed items, in alphabetical order. */
export function repositories(items: readonly ListItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.targetRepo) seen.add(item.targetRepo);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

const ROLE_ORDER: Record<LinkView["role"], number> = { primary: 0, base: 1, covering: 2, fixes: 3, related: 4 };

/** Primary first, then base, covering, fixes and related. */
export function linksByRole(links: readonly LinkView[]): LinkView[] {
  return [...links].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.number - b.number);
}

/** The links an item waits on or may be made unnecessary by. */
export function dependencyLinks(links: readonly LinkView[]): LinkView[] {
  return linksByRole(links.filter((link) => link.role === "base" || link.role === "covering"));
}
