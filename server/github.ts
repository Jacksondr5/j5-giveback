// GitHub GraphQL: one request reads the state of a batch of links.
// Pure helpers plus one fetch. No database access here.

import type { GhCi, GhReviewDecision, GhState } from "../shared/enums";
import { pipelineMarker, type UpstreamRules } from "../shared/upstreamRules";

export const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
export const DEFAULT_SELF_LOGIN = "Jacksondr5";
/** The bot whose PR comment carries the approvability verdict. */
export const MACROSCOPE_LOGIN = "macroscopeapp";

// The handler's transaction has 5,000 ms in total, and the fetch runs inside it.
const FETCH_TIMEOUT_MS = 3500;
const RECENT = 20;
// Macroscope comments once, soon after a PR opens, and edits that comment in place.
const FIRST_COMMENTS = 4;

export type LinkTarget = { repo: string; number: number; kind: string };

const ACTOR = "author{login __typename}";
// How many label events are read to find when a label was last applied. Upstream's own bot reads as many.
const LABEL_EVENTS = 20;
// A clock depends on labels, so a PR's are read as far as upstream's bot reads them.
const PR_LABELS = 100;
// The pipeline's marker is in one of a PR's last comments. Their bodies are large, so few are read.
const MARKER_COMMENTS = 8;

const PR_FRAGMENT = `
fragment PrFields on PullRequest {
  title createdAt prState: state isDraft mergedAt closedAt updatedAt headRefOid reviewDecision mergeable
  mergedBy{login __typename}
  labels(first:${PR_LABELS}){nodes{name}}
  commits(last:1){nodes{commit{statusCheckRollup{state}}}}
  firstComments: comments(first:${FIRST_COMMENTS}){nodes{${ACTOR} createdAt body}}
  comments(last:${RECENT}){nodes{${ACTOR} createdAt}}
  lastComments: comments(last:${MARKER_COMMENTS}){nodes{createdAt authorAssociation body}}
  reviews(last:${RECENT}){nodes{${ACTOR} submittedAt}}
  labelEvents: timelineItems(itemTypes:[LABELED_EVENT],last:${LABEL_EVENTS}){nodes{... on LabeledEvent{createdAt label{name}}}}
}`;
const ISSUE_FRAGMENT = `
fragment IssueFields on Issue {
  title createdAt issueState: state closedAt updatedAt
  labels(first:20){nodes{name}}
  comments(last:${RECENT}){nodes{${ACTOR} createdAt}}
}`;
const DISCUSSION_FRAGMENT = `
fragment DiscussionFields on Discussion {
  title createdAt closed closedAt updatedAt
  labels(first:20){nodes{name}}
  comments(last:${RECENT}){nodes{${ACTOR} createdAt}}
}`;

export function aliasFor(index: number): string {
  return `l${index}`;
}

/** Builds one query with an aliased `repository` per link. Repo names are validated on write and quoted here. */
export function buildQuery(targets: LinkTarget[]): string {
  const parts = targets.map((target, index) => {
    const slash = target.repo.indexOf("/");
    const owner = JSON.stringify(target.repo.slice(0, slash));
    const name = JSON.stringify(target.repo.slice(slash + 1));
    const number = Math.trunc(target.number);
    const selection =
      target.kind === "discussion"
        ? `node: discussion(number:${number}){__typename ...DiscussionFields}`
        : `node: issueOrPullRequest(number:${number}){__typename ...PrFields ...IssueFields}`;
    return `${aliasFor(index)}: repository(owner:${owner},name:${name}){${selection}}`;
  });
  // GitHub rejects a document that defines a fragment it does not use, so only
  // the fragments this batch needs are sent. The two `state` fields have different
  // enum types, so each is aliased.
  const hasDiscussion = targets.some((target) => target.kind === "discussion");
  const hasOther = targets.some((target) => target.kind !== "discussion");
  const fragments = `${hasOther ? PR_FRAGMENT + ISSUE_FRAGMENT : ""}${hasDiscussion ? DISCUSSION_FRAGMENT : ""}`;
  return `query{rateLimit{remaining}\n${parts.join("\n")}\n}${fragments}`;
}

export type Snapshot = {
  title: string;
  state: GhState;
  /** When the PR, issue or discussion was opened. */
  createdAt: number | null;
  isDraft: boolean | null;
  mergedAt: number | null;
  closedAt: number | null;
  ci: GhCi | null;
  reviewDecision: GhReviewDecision | null;
  labels: string[];
  headSha: string | null;
  /** The thread's `updatedAt`: any push, comment, review or label moves it. */
  lastActivityAt: number | null;
  /**
   * When the closing label was last applied. Null unless the PR carries that label
   * now, and null when its label event was not among those read.
   */
  closingNoticeAt: number | null;
  /** A PR's "MERGEABLE", "CONFLICTING" or "UNKNOWN". Null for anything else. */
  mergeable: string | null;
  /** Null when none of the comments and reviews read were by another person. */
  otherActivityAt: number | null;
  otherActivityBy: string | null;
  /** Null when no Macroscope comment was among those read. */
  macroscopeVerdict: string | null;
  /** The takeover pipeline's last marker and its time. Null when none was among the comments read. */
  pipelineMarker: string | null;
  pipelineMarkerAt: number | null;
};

type Obj = Record<string, unknown>;

export function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function time(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function nodes(value: unknown): Obj[] {
  if (!isObj(value) || !Array.isArray(value.nodes)) return [];
  return value.nodes.filter(isObj);
}

function isOtherPerson(actor: unknown, selfLogin: string): actor is Obj & { login: string } {
  if (!isObj(actor) || typeof actor.login !== "string") return false;
  if (actor.__typename === "Bot" || actor.login.endsWith("[bot]")) return false;
  return actor.login.toLowerCase() !== selfLogin.toLowerCase();
}

/** Reads "**Verdict:** Approved at `7c6aff6`" out of Macroscope's approvability comment. */
export function macroscopeVerdictFrom(body: unknown): string | null {
  if (typeof body !== "string") return null;
  const match = /\*\*Verdict:\*\*[ \t]*([^\r\n]+)/.exec(body);
  if (!match || !match[1]) return null;
  const verdict = match[1].replace(/[`*_]/g, "").trim();
  return verdict.length > 0 ? verdict.slice(0, 80) : null;
}

function ciFrom(rollupState: unknown): GhCi | null {
  switch (rollupState) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    case "PENDING":
    case "EXPECTED":
      return "pending";
    default:
      return null;
  }
}

function reviewDecisionFrom(value: unknown): GhReviewDecision | null {
  switch (value) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return null;
  }
}

/**
 * Turns one `node` from the response into a snapshot, or null when it is not a shape this code knows.
 * `rules` are the repository's, when it has some: its closing label's time and its pipeline's marker are read.
 */
export function snapshotFrom(node: unknown, selfLogin: string, rules: UpstreamRules | null = null): Snapshot | null {
  if (!isObj(node)) return null;
  const typename = node.__typename;
  const title = str(node.title);
  if (title === null) return null;

  let state: GhState;
  if (typename === "PullRequest") {
    state = node.prState === "MERGED" ? "merged" : node.prState === "CLOSED" ? "closed" : "open";
  } else if (typename === "Issue") {
    state = node.issueState === "CLOSED" ? "closed" : "open";
  } else if (typename === "Discussion") {
    state = node.closed === true ? "closed" : "open";
  } else {
    return null;
  }

  let otherActivityAt: number | null = null;
  let otherActivityBy: string | null = null;
  const consider = (actor: unknown, at: number | null) => {
    if (at === null || !isOtherPerson(actor, selfLogin)) return;
    if (otherActivityAt === null || at > otherActivityAt) {
      otherActivityAt = at;
      otherActivityBy = actor.login;
    }
  };
  for (const comment of nodes(node.comments)) consider(comment.author, time(comment.createdAt));
  for (const review of nodes(node.reviews)) consider(review.author, time(review.submittedAt));

  let macroscopeVerdict: string | null = null;
  let ci: GhCi | null = null;
  let headSha: string | null = null;
  const isPr = typename === "PullRequest";
  if (isPr) {
    consider(node.mergedBy, time(node.mergedAt));
    for (const comment of nodes(node.firstComments)) {
      if (isObj(comment.author) && comment.author.login === MACROSCOPE_LOGIN) {
        macroscopeVerdict = macroscopeVerdictFrom(comment.body) ?? macroscopeVerdict;
      }
    }
    const commit = nodes(node.commits)[0]?.commit;
    const rollup = isObj(commit) ? commit.statusCheckRollup : null;
    ci = isObj(rollup) ? ciFrom(rollup.state) : null;
    headSha = str(node.headRefOid);
  }

  const labels = nodes(node.labels)
    .map((label) => str(label.name))
    .filter((name): name is string => name !== null);
  // The label can be removed and applied again, so the last application is the one that counts.
  // It is kept only while the PR carries the label: an old notice that was lifted is no notice.
  let closingNoticeAt: number | null = null;
  const closingLabel = rules?.closingLabel ?? null;
  if (isPr && closingLabel !== null && labels.includes(closingLabel)) {
    for (const event of nodes(node.labelEvents)) {
      const at = time(event.createdAt);
      if (at === null || !isObj(event.label) || event.label.name !== closingLabel) continue;
      if (closingNoticeAt === null || at > closingNoticeAt) closingNoticeAt = at;
    }
  }

  const marker =
    isPr && rules?.takeover
      ? pipelineMarker(
          nodes(node.lastComments).map((comment) => ({
            body: comment.body,
            at: time(comment.createdAt),
            association: comment.authorAssociation
          })),
          rules.takeover
        )
      : null;

  return {
    title: title.slice(0, 200),
    state,
    createdAt: time(node.createdAt),
    isDraft: isPr ? node.isDraft === true : null,
    mergedAt: isPr ? time(node.mergedAt) : null,
    closedAt: time(node.closedAt),
    ci,
    reviewDecision: isPr ? reviewDecisionFrom(node.reviewDecision) : null,
    labels,
    headSha,
    lastActivityAt: time(node.updatedAt),
    closingNoticeAt,
    mergeable: isPr ? str(node.mergeable) : null,
    otherActivityAt,
    otherActivityBy,
    macroscopeVerdict,
    pipelineMarker: marker?.marker ?? null,
    pipelineMarkerAt: marker?.at ?? null
  };
}

export type GithubResult =
  | {
      ok: true;
      data: Obj;
      errorsByAlias: Map<string, string>;
      /** The first error GitHub reported beside the data, whatever it was about. Null when there was none. */
      firstError: string | null;
      rateLimitRemaining: number | null;
    }
  | { ok: false; message: string };

/**
 * Sends the query. Never throws: a network error, a timeout, a non-200 status
 * or a response with no data comes back as `{ ok: false }` with a short message
 * that is safe to store and show. Response bodies are not copied into it.
 */
export async function fetchGithub(token: string, query: string, url: string = GITHUB_GRAPHQL_URL): Promise<GithubResult> {
  // Timers are not available in capsule server code, so the timeout is an AbortSignal.
  const signal =
    typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
      : null;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/vnd.github+json",
        "user-agent": "giveback-dashboard"
      },
      body: JSON.stringify({ query }),
      ...(signal ? { signal } : {})
    });
    if (!response.ok) {
      const hint =
        response.status === 401
          ? " (the token was rejected)"
          : response.status === 403 || response.status === 429
            ? " (rate limited or forbidden)"
            : "";
      return { ok: false, message: `GitHub returned HTTP ${response.status}${hint}.` };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { ok: false, message: "GitHub returned a response that is not JSON." };
    }
    if (!isObj(payload)) {
      return { ok: false, message: "GitHub returned a response that is not a JSON object." };
    }
    const errorsByAlias = new Map<string, string>();
    let firstError: string | null = null;
    if (Array.isArray(payload.errors)) {
      for (const error of payload.errors) {
        if (!isObj(error)) {
          firstError ??= "GitHub error ERROR.";
          continue;
        }
        const type = str(error.type) ?? "ERROR";
        const message = type === "NOT_FOUND" ? "Not found on GitHub." : `GitHub error ${type}.`;
        firstError ??= message;
        const alias = Array.isArray(error.path) ? error.path[0] : null;
        if (typeof alias === "string" && !errorsByAlias.has(alias)) {
          errorsByAlias.set(alias, message);
        }
      }
    }
    if (!isObj(payload.data)) {
      return { ok: false, message: firstError ?? "GitHub returned no data." };
    }
    const rateLimit = payload.data.rateLimit;
    const remaining = isObj(rateLimit) && typeof rateLimit.remaining === "number" ? rateLimit.remaining : null;
    return { ok: true, data: payload.data, errorsByAlias, firstError, rateLimitRemaining: remaining };
  } catch (error) {
    const aborted = isObj(error) && (error.name === "AbortError" || error.name === "TimeoutError");
    return {
      ok: false,
      message: aborted ? `GitHub did not answer within ${FETCH_TIMEOUT_MS} ms.` : "The request to GitHub failed."
    };
  }
}
