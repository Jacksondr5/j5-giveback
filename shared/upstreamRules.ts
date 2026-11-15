// The contribution rules an upstream repository enforces with a bot, and what
// follows from them here: how many PRs of ours may be open, when one of them is
// due to be closed, and how many posts went upstream in a week.
//
// Pure TypeScript: imported by the server and the client. No DOM, no Lakebed.
//
// The rules are keyed by repository. A repository that is not in the map has no
// slots and no clocks: nothing here applies to it.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export type UpstreamRules = {
  /** Open PRs one contributor may have. One more is closed as it opens. */
  openPrLimit: number;
  /** A PR carrying `rebaseLabel` is closed after this many days with no activity, while it still conflicts. */
  conflictIdleDays: number;
  /** A PR carrying `closingLabel` is closed this many hours after the label was applied. */
  noticeHours: number;
  rebaseLabel: string;
  closingLabel: string;
  /** A PR carrying this label is exempt from both clocks. */
  keepOpenLabel: string;
  /** Upstream puts this on a PR whose author is not vouched for. Only such a PR is asked to rebase. */
  unvouchedLabel: string;
  /** When the bot's daily sweep runs, in minutes after 00:00 UTC. A close happens at the first sweep after its deadline. */
  sweepMinuteUtc: number;
};

/** "owner/name" in lower case → its rules. */
export const UPSTREAM_RULES: Readonly<Record<string, UpstreamRules>> = {
  "pingdotgg/t3code": {
    openPrLimit: 3,
    conflictIdleDays: 7,
    noticeHours: 72,
    rebaseLabel: "needs-rebase",
    closingLabel: "triage:closing",
    keepOpenLabel: "triage:keep-open",
    unvouchedLabel: "vouch:unvouched",
    sweepMinuteUtc: 5 * 60 + 23
  }
};

/** The repositories that have rules, as written in the map. */
export const RULES_REPOS: readonly string[] = Object.keys(UPSTREAM_RULES);

/** The rules of a repository, or null when it has none. GitHub names are not case-sensitive. */
export function rulesFor(repo: string | null | undefined): UpstreamRules | null {
  if (typeof repo !== "string") return null;
  return UPSTREAM_RULES[repo.toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Closing clocks
// ---------------------------------------------------------------------------

// GitHub stamps a label event and the PR's own "updated" time a second or two
// apart. Upstream's bot treats anything within this of the notice as the notice itself.
export const SAME_MOMENT_MS = 15_000;

/** What the clock reads from a link. `LinkView` has all of it. */
export type ClockLink = {
  repo: string;
  kind: string;
  ownership: string;
  /** "open", "closed", "merged", or null when GitHub has not been read. */
  state: string | null;
  labels: readonly string[];
  /** The PR's "updated" time on GitHub: any push, comment, review or label moves it. */
  lastActivityAt: number | null;
  /** When the closing label was last applied. Null when the PR does not carry it, or the time could not be read. */
  closingNoticeAt: number | null;
  /** GitHub's answer to "can it merge": "MERGEABLE", "CONFLICTING" or "UNKNOWN". Null when it was not read. */
  mergeable: string | null;
};

export type ClosingClock =
  /** A closing notice is running: the PR closes at the first sweep after `closesAt` unless something happens on it. */
  | { kind: "notice"; closesAt: number; due: boolean }
  /** Something happened on the PR after its notice. The next sweep removes the notice: it is back for another look. */
  | { kind: "answered"; noticeAt: number }
  /** The PR carries the closing label and the time it was applied is not known. Upstream leaves such a PR open. */
  | { kind: "notice_unknown" }
  /** A rebase was asked for: the PR closes at the first sweep after `closesAt` if it still conflicts and nothing happened on it. */
  | { kind: "rebase"; closesAt: number; due: boolean };

/**
 * The clock upstream's bot has running on a link at `now`, or null when there is none.
 *
 * Only an open PR of ours in a repository with rules has one, and the keep-open
 * label stops both. A closing notice outranks a rebase request: while a PR
 * carries the notice, the bot does not look at its conflict.
 *
 * The rebase clock runs only where the bot would close: on a PR marked as
 * unvouched that GitHub does not report as mergeable. On any other PR the bot's
 * next sweep takes the rebase label off instead. When GitHub's answer is not
 * known, the clock is shown, since the label was put there for a conflict.
 */
export function closingClock(link: ClockLink, now: number): ClosingClock | null {
  const rules = rulesFor(link.repo);
  if (!rules) return null;
  if (link.kind !== "pr" || link.ownership !== "ours" || link.state !== "open") return null;
  if (link.labels.includes(rules.keepOpenLabel)) return null;

  if (link.labels.includes(rules.closingLabel)) {
    const noticeAt = link.closingNoticeAt;
    if (noticeAt === null) return { kind: "notice_unknown" };
    if (link.lastActivityAt !== null && link.lastActivityAt - noticeAt > SAME_MOMENT_MS) {
      return { kind: "answered", noticeAt };
    }
    const closesAt = noticeAt + rules.noticeHours * HOUR;
    return { kind: "notice", closesAt, due: now >= closesAt };
  }

  const subject = link.labels.includes(rules.unvouchedLabel) && link.mergeable !== "MERGEABLE";
  if (subject && link.labels.includes(rules.rebaseLabel) && link.lastActivityAt !== null) {
    const closesAt = link.lastActivityAt + rules.conflictIdleDays * DAY;
    return { kind: "rebase", closesAt, due: now >= closesAt };
  }
  return null;
}

/** The first daily sweep at or after `at`. */
export function nextSweepAt(rules: UpstreamRules, at: number): number {
  const sweep = Math.floor(at / DAY) * DAY + rules.sweepMinuteUtc * MINUTE;
  return sweep >= at ? sweep : sweep + DAY;
}

/** "05:23": when the daily sweep runs, in UTC. */
export function sweepTimeUtc(rules: UpstreamRules): string {
  const hours = Math.floor(rules.sweepMinuteUtc / 60);
  const minutes = rules.sweepMinuteUtc % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Whether a link fills one of our PR slots: a PR of ours that is open on GitHub,
 * or that GitHub has not been read for yet. A PR just recorded is open until
 * the first refresh says otherwise, so it counts.
 */
export function fillsSlot(link: { kind: string; ownership: string; state: string | null }): boolean {
  return link.kind === "pr" && link.ownership === "ours" && (link.state === "open" || link.state === null);
}

// ---------------------------------------------------------------------------
// The queue for a slot
// ---------------------------------------------------------------------------

/**
 * Whether Jackson has approved the text of an item's upstream post.
 * "approved": the newest text-approval ask is closed. "awaiting": it is open.
 * "none": the item has no text-approval ask, so no text has been put to him yet.
 */
export type TextApproval = "approved" | "awaiting" | "none";

/** Derives it from an item's asks. The newest ask is the one opened last. */
export function textApproval(asks: readonly { kind: string; openedAt: number; isOpen: boolean }[]): TextApproval {
  let newest: { openedAt: number; isOpen: boolean } | null = null;
  for (const ask of asks) {
    if (ask.kind !== "text_approval") continue;
    if (newest === null || ask.openedAt > newest.openedAt) newest = ask;
  }
  if (newest === null) return "none";
  return newest.isOpen ? "awaiting" : "approved";
}

/**
 * Orders the items that wait for a slot: lowest `queueRank` first, items with
 * no rank after every ranked one, and the longest-waiting first among equals.
 */
export function queueOrder<T extends { queueRank: number | null; waitingSince: number }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => (a.queueRank ?? Infinity) - (b.queueRank ?? Infinity) || a.waitingSince - b.waitingSince
  );
}

// ---------------------------------------------------------------------------
// Upstream posts per week
// ---------------------------------------------------------------------------

/** How many weeks the post count covers, the current one included. */
export const POST_WEEKS = 8;

/** Monday 00:00 UTC of the week `at` falls in. 1 January 1970 was a Thursday. */
export function weekStartUtc(at: number): number {
  const day = Math.floor(at / DAY);
  const sinceMonday = (((day + 3) % 7) + 7) % 7;
  return (day - sinceMonday) * DAY;
}

/** The earliest time the post count reads from: the start of the oldest of its weeks. */
export function postsWindowStart(now: number): number {
  return weekStartUtc(now) - (POST_WEEKS - 1) * WEEK;
}

/**
 * Our own limits on how much goes upstream, set by Jackson on 2026-11-14. They
 * are his, not upstream's: upstream has sanctioned only bursts far above these.
 * "About" for the week: it is a guide to stay near, and the day's limit is firm.
 */
export const POSTING_CAPS = {
  /** All upstream posts together, in 7 days. */
  perWeek: 10,
  /** All upstream posts together, in 24 hours. */
  perDay: 3,
  /** New PRs opened in 7 days. */
  newPrsPerWeek: 2,
  /** New issues filed in 7 days. */
  newIssuesPerWeek: 2
} as const;

/**
 * What a post read from GitHub is. "pr" and "issue" are a thread's creation.
 * "reopen" is a PR of ours opened again: a post, and not a new PR.
 * "review" is one submitted review, however many inline comments it carries.
 */
export const POST_KINDS = ["pr", "issue", "reopen", "review", "comment", "discussion", "discussion_comment"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export type Post = { at: number; kind: PostKind };

/** The stored form of a repository's posts: one per line, "<epoch milliseconds> <kind>". */
export function formatPosts(posts: readonly Post[]): string {
  return posts.map((post) => `${post.at} ${post.kind}`).join("\n");
}

/** Reads the stored form back. A line that is not a time and a known kind is skipped. */
export function parsePosts(text: string | null | undefined): Post[] {
  const posts: Post[] = [];
  for (const line of (text ?? "").split("\n")) {
    const match = /^([0-9]{1,15}) ([a-z_]+)$/.exec(line);
    const kind = POST_KINDS.find((known) => known === match?.[2]);
    if (match && kind) posts.push({ at: Number(match[1]), kind });
  }
  return posts;
}

/** Posts read from GitHub are counted while the read is no older than this. After it, the recorded events are. */
export const GITHUB_POSTS_MAX_AGE = 2 * HOUR;

/** What the count reads of a stored row: one repository's posts, as GitHub last gave them. */
export type StoredPosts = {
  repo: string;
  /** The last read that succeeded. A failed read leaves it, and the posts, as they were. */
  readAt?: number | null;
  incomplete?: boolean | null;
  posts?: string | null;
};

/**
 * The posts to count from GitHub, or null when the recorded events must be
 * counted instead: some repository with rules has no row, or its last good
 * read is older than `GITHUB_POSTS_MAX_AGE`.
 */
export function githubPosts(
  rows: readonly StoredPosts[],
  now: number,
  repos: readonly string[] = RULES_REPOS
): { posts: Post[]; countedAt: number; incomplete: boolean } | null {
  if (repos.length === 0) return null;
  const posts: Post[] = [];
  let countedAt = Infinity;
  let incomplete = false;
  for (const repo of repos) {
    const row = rows.find((candidate) => candidate.repo.toLowerCase() === repo.toLowerCase());
    if (!row || typeof row.readAt !== "number" || now - row.readAt > GITHUB_POSTS_MAX_AGE) return null;
    posts.push(...parsePosts(row.posts));
    // The count is as old as the repository read longest ago.
    countedAt = Math.min(countedAt, row.readAt);
    incomplete ||= row.incomplete === true;
  }
  return { posts, countedAt, incomplete };
}

/** What a post's URL says it started: a PR, an issue, or neither (a comment, a reply, a discussion post, or no URL). */
export function postStarts(url: string | null | undefined): "pr" | "issue" | null {
  if (typeof url !== "string") return null;
  // A comment's URL carries a fragment, so only the thread's own address matches. A query string changes nothing.
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/[0-9]+\/?(?:\?[^#]*)?$/.exec(url);
  if (!match) return null;
  return match[1] === "pull" ? "pr" : "issue";
}

export type PostCounts = {
  /** Posts in the 7 days up to now. */
  last7Days: number;
  /** Posts in the 24 hours up to now. */
  last24Hours: number;
  /** One entry per week, oldest first. The last is the current week, which is still running. */
  weeks: { start: number; count: number }[];
};

/** Counts post times into the last 7 days and the last `POST_WEEKS` weeks. Times outside both are ignored. */
export function countPosts(times: readonly number[], now: number): PostCounts {
  const first = postsWindowStart(now);
  const weeks = Array.from({ length: POST_WEEKS }, (_, index) => ({ start: first + index * WEEK, count: 0 }));
  let last7Days = 0;
  let last24Hours = 0;
  for (const at of times) {
    // A post dated ahead of the clock has not happened yet.
    if (at > now) continue;
    if (at > now - WEEK) last7Days += 1;
    if (at > now - DAY) last24Hours += 1;
    const week = weeks[Math.floor((at - first) / WEEK)];
    if (at >= first && week) week.count += 1;
  }
  return { last7Days, last24Hours, weeks };
}

/**
 * New PRs and new issues among the posts of the 7 days up to now. A thread
 * counts once, at its creation: a post read from GitHub says what it is by its
 * kind, so a reopened PR is no new PR. A recorded event says it by its URL.
 */
export function countNewThreads(
  posts: readonly { at: number; url?: string | null; kind?: PostKind }[],
  now: number
): { newPrsLast7Days: number; newIssuesLast7Days: number } {
  let newPrsLast7Days = 0;
  let newIssuesLast7Days = 0;
  for (const post of posts) {
    if (post.at > now || post.at <= now - WEEK) continue;
    const starts = post.kind === undefined ? postStarts(post.url) : post.kind;
    if (starts === "pr") newPrsLast7Days += 1;
    else if (starts === "issue") newIssuesLast7Days += 1;
  }
  return { newPrsLast7Days, newIssuesLast7Days };
}
