// Size and batch limits. The server enforces them; the client and the agent script may show them.

export const LIMITS = {
  // Text lengths, in characters.
  slugMin: 3,
  slugMax: 64,
  title: 120,
  summary: 300,
  routeReason: 300,
  validationVerdict: 200,
  followUpNote: 300,
  sha: 40,
  repo: 100,
  url: 300,
  originRef: 200,
  originRefs: 10,
  eventNote: 280,
  askLabel: 140,
  askResolution: 200,
  key: 80,
  triageBucket: 40,
  privateNotes: 2000,
  privateImpact: 2000,
  privateBranch: 200,
  askRecommendation: 2000,
  askDraftPointer: 300,

  // Batch sizes. One request is one database transaction with at most 100 index scans,
  // 1,000 writes and 1,000 rows returned, so batches are small.
  itemsPerBatch: 25,
  linksPerItem: 20,
  asksPerBatch: 30,
  eventsPerBatch: 40,
  exportRowsPerPage: 500,
  refreshLinksPerBatch: 20,

  // The public list query returns every item and its primary link in one handler
  // (1,000 rows returned at most), so the item count is capped.
  maxItems: 400
} as const;

/** Substrings that mark a local filesystem path. No stored string may contain one. */
export const LOCAL_PATH_MARKERS = ["/home/", "/tmp/", "/mnt/", "/Users/", "/root/", "~/"] as const;

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
export const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:#-]*$/;
export const REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/;
/** The shape of a Lakebed pagination cursor. */
export const CURSOR_PATTERN = /^v1\.[A-Za-z0-9_.-]{8,2000}$/;
