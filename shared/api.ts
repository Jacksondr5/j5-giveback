// Payload types: what agents send to the HTTP endpoints, and what queries return to the client.
// All times in responses are Unix epoch milliseconds.

import type {
  AskKind,
  ChangeKind,
  EventActor,
  EventType,
  FollowUpState,
  GhCi,
  GhReviewDecision,
  GhState,
  LinkKind,
  LinkOwnership,
  LinkRole,
  Outcome,
  Route,
  Stage,
  WaitingOn
} from "./enums";
import type { ClosingClock, TakeoverState, TextApproval } from "./upstreamRules";

// ---------------------------------------------------------------------------
// Agent endpoint requests
// ---------------------------------------------------------------------------

/** A time in a request: epoch milliseconds, or an ISO 8601 string such as "2026-11-09T15:38:46Z". */
export type TimeInput = number | string;

export type LinkInput = {
  /** Full https://github.com/<repo>/... URL. Identifies the link within its item. */
  url: string;
  /** "owner/name". */
  repo: string;
  /** PR, issue or discussion number. For a comment, the number of the thread it is on. */
  number: number;
  kind: LinkKind;
  ownership: LinkOwnership;
  role: LinkRole;
  /** Triage-board bucket and rank. The refresh does not set these; the agent does. */
  triageBucket?: string | null;
  triageRank?: number | null;
};

export type ItemPrivateInput = {
  notes?: string | null;
  impact?: string | null;
  preparedBranch?: string | null;
  /** The agent that owns this item's work: the name it is recognised by. */
  agentName?: string | null;
  /** Where other agents message that agent. No spaces. */
  agentAddress?: string | null;
};

/**
 * One item in `POST /api/agent/items`. `slug` identifies it.
 * To create an item, send slug, title, summary, stage, waitingOn, targetRepo and isPublic.
 * To change one, send slug and the fields that change. An omitted field keeps its value.
 * `null` clears an optional field.
 */
export type ItemInput = {
  slug: string;
  title?: string;
  summary?: string;
  stage?: Stage;
  route?: Route | null;
  routeReason?: string | null;
  waitingOn?: WaitingOn;
  /** Defaults to now when `waitingOn` changes. */
  waitingSince?: TimeInput;
  /** Required when stage is "closed". Not allowed otherwise. */
  outcome?: Outcome | null;
  targetRepo?: string;
  originRefs?: string[];
  /** Defaults to now on create. */
  foundAt?: TimeInput;
  lastValidatedAt?: TimeInput | null;
  lastValidatedSha?: string | null;
  validationVerdict?: string | null;
  followUpState?: FollowUpState;
  followUpNote?: string | null;
  isPublic?: boolean;
  /**
   * The item's place in the queue for a PR slot: a whole number from 1 to 999, lower first. `null` clears it.
   * Allowed only while `waitingOn` is "pr_slot" and the item is not closed; the server clears it otherwise.
   */
  queueRank?: number | null;
  /** The verdict under upstream's test: a change to how the product behaves is a feature. `null` clears it. */
  changeKind?: ChangeKind | null;
  /** Defaults to now when the stage becomes "closed". */
  closedAt?: TimeInput | null;
  /** Public note for the stage-change event this request causes, if it causes one. */
  stageNote?: string;
  /** When that event happened, if this request causes one. Defaults to now. Must not be in the future. */
  stageEventAt?: TimeInput;
  /** `true` clears the "state changed upstream" marker the refresh raised. */
  clearUpstreamChange?: boolean;
  /** When present, replaces the item's whole link set. */
  links?: LinkInput[];
  /** When present, merged into the item's private fields. */
  private?: ItemPrivateInput;
};

export type ItemsRequest = { items: ItemInput[] };

export type AskPrivateInput = {
  recommendation?: string | null;
  draftPointer?: string | null;
};

export type AskInput =
  | {
      op: "open";
      /** Stable, chosen by the caller. A retry with the same key does not duplicate. */
      key: string;
      /** Item slug. */
      item: string;
      kind: AskKind;
      /** Public-safe reason, shown to anyone when the item is public. */
      publicLabel: string;
      openedAt?: TimeInput;
      private?: AskPrivateInput;
    }
  | {
      op: "close";
      key: string;
      /** Public-safe resolution, such as "Approved" or "Chose issue first". */
      resolution?: string;
      closedAt?: TimeInput;
    };

export type AsksRequest = { asks: AskInput[] };

export type EventInput = {
  /** Stable, chosen by the caller. A retry with the same key does not duplicate. */
  key: string;
  /** Item slug. */
  item: string;
  /** Defaults to now. */
  at?: TimeInput;
  actor: EventActor;
  type: EventType;
  note: string;
  url?: string | null;
  /** Required. A private event is shown only to the owner. */
  isPublic: boolean;
};

export type EventsRequest = { events: EventInput[] };

/** `POST /api/agent/events/delete`. Keys of events to remove, the server's own "auto:" keys included. */
export type EventsDeleteRequest = { keys: string[] };

/** One link in `POST /api/agent/links`. Send `url` and at least one of the two triage fields. `null` clears a field. */
export type LinkPatchInput = {
  /** The link's URL, exactly as stored. Every link with this URL is patched, on whichever items it sits. */
  url: string;
  triageBucket?: string | null;
  triageRank?: number | null;
};

export type LinksPatchRequest = { links: LinkPatchInput[] };

// ---------------------------------------------------------------------------
// Agent endpoint responses
// ---------------------------------------------------------------------------

export type ValidationIssue = { path: string; message: string };

export type ApiError = {
  ok: false;
  error: string;
  message: string;
  /** Present when error is "validation_failed". Nothing was applied. */
  errors?: ValidationIssue[];
};

export type WriteStatus = "created" | "updated" | "unchanged";

export type ItemsResponse = {
  ok: true;
  results: {
    slug: string;
    /** The row id. */
    id: string;
    /** The item's number. Null only for an item stored before numbers existed and not yet backfilled. */
    number: number | null;
    /** The number as an ID, such as "GB-12". */
    shortId: string | null;
    status: WriteStatus;
    stageEvent: boolean;
  }[];
};

/** `POST /api/agent/items/assign-numbers`. The body is optional. */
export type AssignNumbersRequest = {
  /** How many items one call may number. Default 100, at most 350. */
  limit?: number;
};

export type AssignNumbersResponse = {
  ok: true;
  /** The items this call numbered, in the order they were numbered. Empty when every item already had a number. */
  assigned: { slug: string; id: string; number: number; shortId: string }[];
  /** Items still without a number. Call again until this is 0. */
  remaining: number;
  /** The number the next new item will get. */
  nextNumber: number;
};

export type AsksResponse = {
  ok: true;
  results: { key: string; id: string; status: WriteStatus; open: boolean }[];
};

export type EventsResponse = {
  ok: true;
  results: { key: string; id: string; status: "created" | "exists" }[];
};

export type EventsDeleteResponse = {
  ok: true;
  /** Event rows removed by this request. */
  deleted: number;
  results: { key: string; status: "deleted" | "not_found" }[];
};

export type LinksPatchResponse = {
  ok: true;
  results: {
    url: string;
    /** "not_found" when no link has this URL. That is reported here, not as an error. */
    status: "updated" | "unchanged" | "not_found";
    /** How many links have this URL. One per item that carries it. */
    matched: number;
  }[];
};

/** One link on an item that is not closed. Null means GitHub has not been read for it yet, or has nothing to say. */
export type WatchlistLink = {
  url: string;
  repo: string;
  number: number;
  kind: LinkKind;
  ownership: LinkOwnership;
  role: LinkRole;
  itemSlug: string;
  /** The item's number and its ID, such as "GB-12". Null for an item not yet numbered. */
  itemNumber: number | null;
  itemShortId: string | null;
  itemStage: Stage;
  ghState: GhState | null;
  /** Last comment or review by someone other than the fork owner, bots excluded. */
  lastOtherActivityAt: number | null;
  syncedAt: number | null;
};

/** One page of `GET /api/agent/watchlist`. Follow `nextCursor` until it is null. */
export type WatchlistResponse = {
  ok: true;
  generatedAt: number;
  /** As in the export: pages of one read must all carry the same value. */
  revision: number;
  links: WatchlistLink[];
  nextCursor: string | null;
};

/** One of our open PRs, in `GET /api/agent/capacity`. It fills one slot. */
export type CapacitySlot = {
  url: string;
  repo: string;
  number: number;
  /** The PR's title on GitHub. Null until the first refresh. */
  title: string | null;
  itemSlug: string;
  itemNumber: number | null;
  itemShortId: string | null;
  itemTitle: string;
  itemIsPublic: boolean;
  /** "open", or null when GitHub has not been read for the link yet. */
  ghState: GhState | null;
  isDraft: boolean | null;
  /** When the PR was opened on GitHub. */
  createdAt: number | null;
  ci: GhCi | null;
  labels: string[];
  lastActivityAt: number | null;
  /** The clock upstream's bot has running on the PR, at `generatedAt`. Null when there is none. */
  closingClock: ClosingClock | null;
  /** What upstream's takeover pipeline is doing with the PR. Null when it carries no pipeline label. */
  takeover: TakeoverState | null;
  syncedAt: number | null;
};

/** One item waiting for a PR slot, in `GET /api/agent/capacity`. */
export type CapacityQueueEntry = {
  /** 1 for the item that goes next. */
  position: number;
  itemSlug: string;
  itemNumber: number | null;
  itemShortId: string | null;
  itemTitle: string;
  itemIsPublic: boolean;
  itemStage: Stage;
  /** The rank the dispatcher set, or null when it set none. */
  queueRank: number | null;
  waitingSince: number;
  /** Whether Jackson approved the text. Null past the first entries, whose asks are not read. */
  text: TextApproval | null;
  changeKind: ChangeKind | null;
};

export type CapacityRepo = {
  repo: string;
  /** Open PRs upstream allows us. */
  limit: number;
  /** How many of our PRs are open: `slots.length`. */
  open: number;
  /** Slots still free: the limit less `open`, never below 0. It is 0 when `incomplete`. */
  free: number;
  /** True when there were more PR links of ours than one read takes. `open` is then a floor, and nothing should be posted on it. */
  incomplete: boolean;
  /** Oldest PR first. */
  slots: CapacitySlot[];
  /** In queue order. */
  queue: CapacityQueueEntry[];
};

/**
 * Our upstream posts. Counted from GitHub, for the whole account in the
 * repositories with rules, when a read no older than two hours is stored.
 * Otherwise counted from events of type "posted", on every item, public or not.
 */
export type PostCountsView = {
  /** Where the count comes from. "events" is the fallback: it misses every post nobody recorded. */
  source: "github" | "events";
  /** When GitHub was read for this count. Null when the source is the events. */
  countedAt: number | null;
  /** Posts in the 7 days up to `generatedAt`. */
  last7Days: number;
  /** The last eight weeks, oldest first. A week starts on Monday 00:00 UTC. The last entry is the current week. */
  weeks: { start: number; count: number }[];
  /** Posts in the 24 hours up to `generatedAt`. */
  last24Hours: number;
  /** Among the last 7 days' posts: those that opened a PR, and those that filed an issue. A reopened PR is not a new one. */
  newPrsLast7Days: number;
  newIssuesLast7Days: number;
  /** Jackson's cap on posts in 7 days. A guide to stay near. Null when none is set. */
  cap: number | null;
  /** His caps on posts in 24 hours, new PRs in 7 days and new issues in 7 days. */
  dailyCap: number | null;
  newPrCap: number | null;
  newIssueCap: number | null;
  /**
   * True when the count may be low: always when the source is the events, and
   * from GitHub when it held more than the read took.
   */
  incomplete: boolean;
};

/** `GET /api/agent/capacity`: whether a PR slot is free, who is next, and how much was posted lately. */
export type CapacityResponse = {
  ok: true;
  generatedAt: number;
  /** One entry per repository that has rules, whether or not anything of ours is there. */
  repos: CapacityRepo[];
  posts: PostCountsView;
};

// New tables go at the end: a cursor names a table by its place in this list.
export const EXPORT_TABLES = ["items", "links", "asks", "events", "itemPrivate", "askPrivate", "syncState", "githubPosts"] as const;
export type ExportTable = (typeof EXPORT_TABLES)[number];

/** One page of `GET /api/agent/export`. Rows are raw table rows. Follow `nextCursor` until it is null. */
export type ExportResponse = {
  ok: true;
  exportedAt: number;
  /** Changes on every agent write. Pages of one export must all carry the same value. */
  revision: number;
  /** The prefix of an item ID: an item row with `number` 12 is "<prefix>-12". */
  itemIdPrefix: string;
  tables: Partial<Record<ExportTable, Record<string, unknown>[]>>;
  nextCursor: string | null;
};

/** `POST /api/refresh/posts`. It carries no count: the count is for the owner and the agents. */
export type RefreshPostsResponse = {
  ok: boolean;
  /** False when the server secret GITHUB_LOGIN is not set. Nothing was read, and the count comes from the recorded events. */
  configured: boolean;
  /** The repositories read. Empty when the read failed or nothing was read. */
  repos: { repo: string; incomplete: boolean }[];
  /** Present when the read failed. Every repository keeps the posts of its last good read. */
  error?: string;
  message?: string;
  rateLimitRemaining?: number | null;
};

export type RefreshResponse = {
  ok: boolean;
  /** Links read from the database for this batch. */
  links: number;
  /** Links whose snapshot was updated. */
  refreshed: number;
  /** Links GitHub could not answer for. Their old snapshot is kept. */
  failed: { url: string; message: string }[];
  /** Events recorded for state changes. */
  events: number;
  /** Pass as `?cursor=` to fetch the next batch. Null when this was the last batch. */
  nextCursor: string | null;
  done: boolean;
  /** Present when the whole batch failed. No snapshot was changed. */
  error?: string;
  message?: string;
  rateLimitRemaining?: number | null;
};

// ---------------------------------------------------------------------------
// Query results
// ---------------------------------------------------------------------------

export type LinkView = {
  id: string;
  repo: string;
  number: number;
  url: string;
  kind: LinkKind;
  ownership: LinkOwnership;
  role: LinkRole;
  /** GitHub snapshot. Null until the first successful refresh. */
  title: string | null;
  state: GhState | null;
  /** When the PR, issue or discussion was opened on GitHub. */
  createdAt: number | null;
  isDraft: boolean | null;
  mergedAt: number | null;
  closedAt: number | null;
  ci: GhCi | null;
  reviewDecision: GhReviewDecision | null;
  labels: string[];
  headSha: string | null;
  /** Macroscope's approvability verdict, read from its PR comment. */
  macroscopeVerdict: string | null;
  /** The thread's "updated" time on GitHub: any push, comment, review or label moves it. */
  lastActivityAt: number | null;
  /** When upstream's closing label was last applied. Null unless the PR carries it now. */
  closingNoticeAt: number | null;
  /** A PR's "MERGEABLE", "CONFLICTING" or "UNKNOWN" on GitHub. Null when it was not read. */
  mergeable: string | null;
  /** The last marker of upstream's takeover pipeline on a PR, such as "stopped-moved", and its time. */
  pipelineMarker: string | null;
  pipelineMarkerAt: number | null;
  /** Last comment or review by someone other than the fork owner, bots excluded. */
  lastOtherActivityAt: number | null;
  lastOtherActivityBy: string | null;
  triageBucket: string | null;
  triageRank: number | null;
  syncedAt: number | null;
  syncError: string | null;
};

/**
 * An item as anyone may see it. When `disclosed` is false, the item is an
 * "Undisclosed candidate": every field below `updatedAt` is null or empty.
 */
export type ItemView = {
  /** Opaque row id. */
  id: string;
  /**
   * The item's number, shown as "GB-<n>" (see shared/itemId.ts). Present for an
   * undisclosed item too: with the row id, it is that item's public handle.
   * Null for an item stored before numbers existed and not yet backfilled.
   */
  number: number | null;
  disclosed: boolean;
  slug: string | null;
  title: string;
  stage: Stage;
  waitingOn: WaitingOn;
  waitingSince: number;
  foundAt: number;
  updatedAt: number;

  summary: string | null;
  route: Route | null;
  routeReason: string | null;
  outcome: Outcome | null;
  closedAt: number | null;
  targetRepo: string | null;
  originRefs: string[];
  lastValidatedAt: number | null;
  lastValidatedSha: string | null;
  validationVerdict: string | null;
  followUpState: FollowUpState | null;
  followUpNote: string | null;
  /** Bug, behaviour change or feature. Null when no verdict is recorded. */
  changeKind: ChangeKind | null;
  /** The item's place in the queue for a PR slot, as the dispatcher set it. */
  queueRank: number | null;
  /** Set by the refresh when a link merged, closed, reopened, began failing CI, or was put on a closing clock. The agent clears it. */
  upstreamChangedAt: number | null;
  upstreamChangeNote: string | null;
  /** The link with role "primary", if any. */
  primaryLink: LinkView | null;
  /**
   * Links with the role base or covering: what the item waits on or may be made
   * unnecessary by. In a list, filled only for items that are not closed.
   */
  dependencyLinks: LinkView[];
};

export type ItemRef = {
  id: string;
  number: number | null;
  disclosed: boolean;
  slug: string | null;
  title: string;
  stage: Stage;
};

export type AskView = {
  id: string;
  kind: AskKind;
  /** Null when the item is undisclosed. */
  label: string | null;
  openedAt: number;
  closedAt: number | null;
  /** Null when open, or when the item is undisclosed. */
  resolution: string | null;
  item: ItemRef;
};

export type EventView = {
  id: string;
  at: number;
  actor: EventActor;
  type: EventType;
  note: string;
  url: string | null;
  isPublic: boolean;
};

export type SyncView = {
  lastGithubSyncAt: number | null;
  /** Last refresh run that finished with no error. */
  lastGithubOkAt: number | null;
  lastAgentPushAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
};

export type StatsView = {
  total: number;
  /** Items whose stage is not "closed". */
  inProgress: number;
  offered: number;
  closed: number;
  merged: number;
  undisclosed: number;
  openAsks: number;
  followUpsOwed: number;
  upstreamChanged: number;
};

/** One of our open PRs. It fills one slot. */
export type PrSlotView = {
  /** Null when the PR sits on an item the caller may not see: the slot is filled, and nothing is said about the PR. */
  link: LinkView | null;
  item: ItemRef;
};

/** One item waiting for a PR slot. */
export type QueueEntryView = {
  /** 1 for the item that goes next. */
  position: number;
  item: ItemRef;
  /** Whether Jackson approved its text. Null for an undisclosed item, and past the first entries, whose asks are not read. */
  text: TextApproval | null;
};

/** The PR slots of one repository that has rules. */
export type RepoSlotsView = {
  repo: string;
  /** Open PRs upstream allows us. */
  limit: number;
  /** Our open PRs, oldest first. More than `limit` when we are over it. */
  slots: PrSlotView[];
  /** Slots still free: the limit less the open PRs, never below 0. It is 0 when `partial`. */
  free: number;
  /** True when there were more PR links of ours than one read takes. The slots shown are then a floor. */
  partial: boolean;
  /** Items waiting for a slot, in order. */
  queue: QueueEntryView[];
};

export type OverviewView = {
  generatedAt: number;
  stats: StatsView;
  /** One entry per stage, in pipeline order. */
  pipeline: { stage: Stage; count: number }[];
  /** Items not closed, by what they wait on. */
  waiting: { waitingOn: WaitingOn; count: number }[];
  /** Closed items, by outcome. */
  outcomes: { outcome: Outcome; count: number }[];
  /** Oldest first. */
  openAsks: AskView[];
  /** One entry per repository with rules that has an item of ours in progress. Empty when none has. */
  prSlots: RepoSlotsView[];
  sync: SyncView;
};

export type ItemDetailView = {
  item: ItemView;
  /** Empty when the item is undisclosed. */
  links: LinkView[];
  asks: AskView[];
  /** Newest first. Public events only, and none when the item is undisclosed. */
  events: EventView[];
};

// Owner views: the same data with nothing hidden, plus the private tables.

export type ItemPrivateView = {
  notes: string | null;
  impact: string | null;
  preparedBranch: string | null;
  agentName: string | null;
  agentAddress: string | null;
};

/** One row of `GET /api/agent/item-agents`: an item that is not closed, and the agent that owns it, if any. */
export type ItemAgentEntry = {
  itemSlug: string;
  itemNumber: number | null;
  itemShortId: string | null;
  itemStage: Stage;
  agentName: string | null;
  agentAddress: string | null;
};

export type ItemAgentsResponse = {
  ok: true;
  generatedAt: number;
  /** How many items that are not closed have no agent recorded. */
  unassigned: number;
  /** True when not every private row could be read. Then an item may wrongly show no agent. */
  incomplete: boolean;
  items: ItemAgentEntry[];
};

export type AskPrivateView = {
  recommendation: string | null;
  draftPointer: string | null;
};

export type OwnerItemView = ItemView & { isPublic: boolean };
export type OwnerAskView = AskView & { key: string; private: AskPrivateView | null };
export type OwnerEventView = EventView & { key: string };

export type OwnerOverviewView = Omit<OverviewView, "openAsks"> & { openAsks: OwnerAskView[] };

export type OwnerItemDetailView = {
  item: OwnerItemView;
  private: ItemPrivateView | null;
  links: LinkView[];
  asks: OwnerAskView[];
  events: OwnerEventView[];
};

export type ViewerView = {
  signedIn: boolean;
  /** The caller's own Lakebed user id when signed in. This is the value to put in OWNER_IDS. */
  userId: string | null;
  isOwner: boolean;
};
