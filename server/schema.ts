import { boolean, id, number, string, table } from "lakebed/server";
import type { ReadDatabaseOf, WriteDatabaseOf } from "lakebed/server";

// Public tables: items, links, asks, events, syncState.
// Private tables: itemPrivate, askPrivate. Public queries get a database type
// that does not contain them (see PublicDb), so they cannot read them.
//
// All times are Unix epoch milliseconds in number() fields.

export const schema = {
  items: table({
    slug: string(),
    // The item's number, shown as "GB-<n>" (shared/itemId.ts). The server assigns it; it never changes
    // and is never reused. Optional because items stored before numbers existed have none until the backfill.
    number: number().optional(),
    title: string(),
    summary: string(),
    stage: string(),
    route: string().optional(),
    routeReason: string().optional(),
    waitingOn: string(),
    waitingSince: number(),
    outcome: string().optional(),
    closedAt: number().optional(),
    targetRepo: string(),
    // J5 origin refs, one per line.
    originRefs: string().default(""),
    foundAt: number(),
    lastValidatedAt: number().optional(),
    lastValidatedSha: string().optional(),
    validationVerdict: string().optional(),
    followUpState: string().default("none"),
    followUpNote: string().optional(),
    isPublic: boolean(),
    // Last change by an agent. Lakebed's own updatedAt also moves when the refresh raises the marker.
    agentUpdatedAt: number(),
    // "State changed upstream" marker. Raised by the refresh, cleared by the agent.
    upstreamChangedAt: number().optional(),
    upstreamChangeNote: string().optional()
  })
    .index("by_slug", ["slug"])
    // Finds an item by its number. Read in descending order, its first row carries the highest number in use.
    .index("by_number", ["number"]),

  links: table({
    itemId: id("items"),
    repo: string(),
    number: number(),
    url: string(),
    kind: string(),
    ownership: string(),
    role: string(),
    // True while the item is not closed.
    active: boolean(),
    // True when the refresh should read this link: the item is not closed, or the
    // link has never been read. A link on a closed item is read once and then left.
    syncDue: boolean(),
    triageBucket: string().optional(),
    triageRank: number().optional(),
    // GitHub snapshot, written by the refresh.
    ghTitle: string().optional(),
    ghState: string().optional(),
    ghCreatedAt: number().optional(),
    ghIsDraft: boolean().optional(),
    ghMergedAt: number().optional(),
    ghClosedAt: number().optional(),
    ghCi: string().optional(),
    ghReviewDecision: string().optional(),
    // One label per line.
    ghLabels: string().optional(),
    ghHeadSha: string().optional(),
    ghLastActivityAt: number().optional(),
    ghOtherActivityAt: number().optional(),
    ghOtherActivityBy: string().optional(),
    macroscopeVerdict: string().optional(),
    syncedAt: number().optional(),
    syncError: string().optional()
  })
    .index("by_item", ["itemId"])
    .index("by_sync_due", ["syncDue"])
    .index("by_role", ["role"])
    .index("by_role_active", ["role", "active"])
    // A URL can sit on more than one item. POST /api/agent/links finds every copy through this.
    .index("by_url", ["url"]),

  asks: table({
    key: string(),
    itemId: id("items"),
    kind: string(),
    publicLabel: string(),
    openedAt: number(),
    isOpen: boolean(),
    closedAt: number().optional(),
    resolution: string().optional()
  })
    .index("by_key", ["key"])
    .index("by_item", ["itemId"])
    .index("by_open", ["isOpen", "openedAt"]),

  events: table({
    key: string(),
    itemId: id("items"),
    at: number(),
    actor: string(),
    type: string(),
    note: string(),
    url: string().optional(),
    isPublic: boolean()
  })
    .index("by_key", ["key"])
    .index("by_item", ["itemId", "at"])
    .index("by_item_public", ["itemId", "isPublic", "at"]),

  itemPrivate: table({
    itemId: id("items"),
    notes: string().optional(),
    impact: string().optional(),
    preparedBranch: string().optional(),
    // The agent that owns the item's work: a name to recognise it by, and the address other agents message it at.
    agentName: string().optional(),
    agentAddress: string().optional()
  }).index("by_item", ["itemId"]),

  askPrivate: table({
    askId: id("asks"),
    recommendation: string().optional(),
    draftPointer: string().optional()
  }).index("by_ask", ["askId"]),

  // One row.
  syncState: table({
    lastGithubSyncAt: number().optional(),
    lastGithubOkAt: number().optional(),
    lastAgentPushAt: number().optional(),
    // Goes up by one on every agent write and every refresh batch. An export whose pages disagree on it is not a consistent copy.
    revision: number().default(0),
    // The number the next new item gets. Absent until the first number is assigned:
    // then it is one more than the highest number in use.
    nextItemNumber: number().optional(),
    lastError: string().optional(),
    lastErrorAt: number().optional(),
    // True when a batch of the refresh run in progress failed.
    refreshRunFailed: boolean().default(false)
  })
};

type Definition = { schema: typeof schema };

export type ReadDb = ReadDatabaseOf<Definition>;
export type WriteDb = WriteDatabaseOf<Definition>;

/** The tables a public query may read. The private tables are absent on purpose. */
export type PublicDb = Pick<ReadDb, "items" | "links" | "asks" | "events" | "syncState">;

type RowOfTable<T> = T extends { get(id: string): Promise<infer R | null> } ? R : never;

export type ItemRow = RowOfTable<ReadDb["items"]>;
export type LinkRow = RowOfTable<ReadDb["links"]>;
export type AskRow = RowOfTable<ReadDb["asks"]>;
export type EventRow = RowOfTable<ReadDb["events"]>;
export type ItemPrivateRow = RowOfTable<ReadDb["itemPrivate"]>;
export type AskPrivateRow = RowOfTable<ReadDb["askPrivate"]>;
export type SyncStateRow = RowOfTable<ReadDb["syncState"]>;
