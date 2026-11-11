// Enumerations for the giveback pipeline, with human labels.
// Pure TypeScript: imported by the server, the client and nothing else.

export const STAGES = ["found", "validating", "deciding", "preparing", "approving", "offered", "closed"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = {
  found: "Found",
  validating: "Validating",
  deciding: "Deciding",
  preparing: "Preparing",
  approving: "Approving",
  offered: "Offered",
  closed: "Closed"
};
export const STAGE_DESCRIPTIONS: Record<Stage, string> = {
  found: "A candidate was recorded by a J5 agent.",
  validating: "Being checked against current upstream main and searched for duplicates.",
  deciding: "Validated and real. Needs a route from Jackson.",
  preparing: "Route chosen. Branch, tests, evidence and post text are being produced.",
  approving: "The exact text of the upstream post is ready for Jackson's approval.",
  offered: "Posted upstream and being babysat.",
  closed: "Has an outcome."
};

export const ROUTES = ["direct_pr", "issue_first", "comment", "discussion", "hold", "drop"] as const;
export type Route = (typeof ROUTES)[number];
export const ROUTE_LABELS: Record<Route, string> = {
  direct_pr: "Direct PR",
  issue_first: "Issue first",
  comment: "Comment on an existing thread",
  discussion: "Ideas discussion",
  hold: "Hold",
  drop: "Drop"
};

export const WAITING_ON = [
  "jackson",
  "maintainer",
  "ci",
  "base_pr",
  "covering_pr",
  "giveback_agent",
  "upstream_advance",
  "nobody"
] as const;
export type WaitingOn = (typeof WAITING_ON)[number];
export const WAITING_ON_LABELS: Record<WaitingOn, string> = {
  jackson: "Jackson",
  maintainer: "Maintainer",
  ci: "CI",
  base_pr: "Base PR",
  covering_pr: "Covering PR",
  giveback_agent: "Giveback agent",
  upstream_advance: "Upstream advance",
  nobody: "Nobody"
};

export const OUTCOMES = [
  "merged",
  "fixed_by_maintainer_pr",
  "taken_over",
  "covered_by_contributor",
  "fixed_upstream",
  "not_a_giveback",
  "parked",
  "dropped",
  "closed_by_upstream"
] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  merged: "Merged",
  fixed_by_maintainer_pr: "Fixed by a maintainer's own PR",
  taken_over: "Taken over by a maintainer",
  covered_by_contributor: "Covered by another contributor",
  fixed_upstream: "Fixed upstream independently",
  not_a_giveback: "Not a give-back",
  parked: "Parked",
  dropped: "Dropped",
  closed_by_upstream: "Closed by upstream"
};

export const LINK_KINDS = ["pr", "issue", "comment", "discussion"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  pr: "Pull request",
  issue: "Issue",
  comment: "Comment",
  discussion: "Discussion"
};

export const LINK_OWNERSHIPS = ["ours", "theirs"] as const;
export type LinkOwnership = (typeof LINK_OWNERSHIPS)[number];
export const LINK_OWNERSHIP_LABELS: Record<LinkOwnership, string> = {
  ours: "Ours",
  theirs: "Theirs"
};

export const LINK_ROLES = ["primary", "base", "covering", "fixes", "related"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];
export const LINK_ROLE_LABELS: Record<LinkRole, string> = {
  primary: "Primary",
  base: "Base (ours waits for it)",
  covering: "Covering (may make ours unnecessary)",
  fixes: "Fixes",
  related: "Related"
};

export const ASK_KINDS = [
  "route_decision",
  "text_approval",
  "bot_ci_findings",
  "maintainer_question",
  "open_on_nod",
  "side_choice",
  "triage_move",
  "device_needed"
] as const;
export type AskKind = (typeof ASK_KINDS)[number];
export const ASK_KIND_LABELS: Record<AskKind, string> = {
  route_decision: "Route decision",
  text_approval: "Text approval",
  bot_ci_findings: "Bot or CI findings",
  maintainer_question: "Maintainer question",
  open_on_nod: "Open-on-nod approval",
  side_choice: "Side choice",
  triage_move: "Triage-board move",
  device_needed: "Device needed"
};

export const EVENT_ACTORS = ["agent", "jackson", "maintainer", "bot", "github"] as const;
export type EventActor = (typeof EVENT_ACTORS)[number];
export const EVENT_ACTOR_LABELS: Record<EventActor, string> = {
  agent: "Agent",
  jackson: "Jackson",
  maintainer: "Maintainer",
  bot: "Bot",
  github: "GitHub"
};

export const EVENT_TYPES = [
  "note",
  "stage_changed",
  "validated",
  "route_decided",
  "posted",
  "ask_opened",
  "ask_closed",
  "review",
  "upstream_merged",
  "upstream_closed",
  "upstream_reopened",
  "ci_failing",
  "dependency_merged",
  "dependency_closed",
  "follow_up"
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  note: "Note",
  stage_changed: "Stage changed",
  validated: "Validated",
  route_decided: "Route decided",
  posted: "Posted upstream",
  ask_opened: "Ask opened",
  ask_closed: "Ask closed",
  review: "Review activity",
  upstream_merged: "Merged upstream",
  upstream_closed: "Closed upstream",
  upstream_reopened: "Reopened upstream",
  ci_failing: "CI failing",
  dependency_merged: "Base or covering link merged",
  dependency_closed: "Base or covering link closed",
  follow_up: "J5 follow-up"
};

export const FOLLOW_UP_STATES = ["none", "owed", "done"] as const;
export type FollowUpState = (typeof FOLLOW_UP_STATES)[number];
export const FOLLOW_UP_STATE_LABELS: Record<FollowUpState, string> = {
  none: "None",
  owed: "Owed",
  done: "Done"
};

// Snapshot values the refresh writes onto a link. Not set by agents.
export const GH_STATES = ["open", "closed", "merged"] as const;
export type GhState = (typeof GH_STATES)[number];
export const GH_STATE_LABELS: Record<GhState, string> = { open: "Open", closed: "Closed", merged: "Merged" };

export const GH_CI_STATES = ["success", "failure", "pending"] as const;
export type GhCi = (typeof GH_CI_STATES)[number];
export const GH_CI_LABELS: Record<GhCi, string> = { success: "Passing", failure: "Failing", pending: "Running" };

export const GH_REVIEW_DECISIONS = ["approved", "changes_requested", "review_required"] as const;
export type GhReviewDecision = (typeof GH_REVIEW_DECISIONS)[number];
export const GH_REVIEW_DECISION_LABELS: Record<GhReviewDecision, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required"
};

/** Shown instead of the title of an item whose `isPublic` is false. */
export const UNDISCLOSED_TITLE = "Undisclosed candidate";

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
