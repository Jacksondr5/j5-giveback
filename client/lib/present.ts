// How query results are worded and marked on screen: the action an ask needs,
// which side of the fork a thread is on, and the icon and words for each state.
// Pure functions of their arguments. Icon names are plain strings here; the
// components map them to drawings.

import type { LinkView } from "../../shared/api";
import type {
  AskKind,
  GhCi,
  GhReviewDecision,
  LinkKind,
  LinkRole,
  Outcome,
  Stage,
  WaitingOn
} from "../../shared/enums";
import type { ListItem } from "./derive";

/** A colour role. Always paired with an icon shape and words, never used alone. */
export type Tone = "open" | "merged" | "closed" | "draft" | "pending" | "dim";

// ---------------------------------------------------------------------------
// Asks: the action each one needs
// ---------------------------------------------------------------------------

const ASK_ACTIONS: Record<AskKind, string> = {
  route_decision: "Choose a route",
  text_approval: "Approve the text",
  bot_ci_findings: "Decide on bot or CI findings",
  maintainer_question: "Answer a maintainer",
  open_on_nod: "Approve opening on a nod",
  side_choice: "Choose between options",
  triage_move: "Review a triage-board move",
  device_needed: "Test on a device"
};

function firstWord(text: string): string {
  return (text.trim().split(/\s+/)[0] ?? "").toLowerCase();
}

// Verbs an agent's label opens with when the label is itself the instruction.
const INSTRUCTION_VERBS = new Set([
  "answer",
  "approve",
  "check",
  "choose",
  "confirm",
  "decide",
  "open",
  "pick",
  "rebase",
  "reply",
  "review",
  "say",
  "test",
  "verify"
]);

/** The kind of action alone, short enough for a tag: "Choose a route". */
export function askKindAction(kind: AskKind): string {
  return ASK_ACTIONS[kind];
}

/**
 * What an ask needs from Jackson: one instruction, and the agent's context when it has some.
 *
 * When the agent's label is itself an instruction ("Rebase onto main or keep
 * the stack", "Approve the issue text"), it is the action and nothing is
 * added, so the row never gives two instructions. When the label states a fact
 * ("Two review-bot findings need a decision"), the kind of action leads and the
 * label follows as context. A null label is an undisclosed item: only the kind
 * of action is shown.
 */
export function askAction(kind: AskKind, label: string | null): { action: string; detail: string | null } {
  const action = ASK_ACTIONS[kind];
  const text = label?.trim() ?? "";
  if (text.length === 0) return { action, detail: null };
  if (INSTRUCTION_VERBS.has(firstWord(text).replace(/[^a-z]/g, ""))) return { action: text, detail: null };
  return { action, detail: text };
}

// ---------------------------------------------------------------------------
// Threads: ours or theirs
// ---------------------------------------------------------------------------

/**
 * Which side of the fork an upstream thread is on.
 * "ours": a PR, issue or discussion J5 opened.
 * "our_comment": J5's comment on a thread that already existed.
 * "theirs": someone else's thread that this item depends on or relates to.
 */
export type ThreadSide = "ours" | "our_comment" | "theirs";

export function threadSide(link: Pick<LinkView, "ownership" | "kind">): ThreadSide {
  if (link.ownership === "theirs") return "theirs";
  return link.kind === "comment" ? "our_comment" : "ours";
}

const KIND_WORDS: Record<LinkKind, string> = { pr: "PR", issue: "issue", comment: "comment", discussion: "discussion" };

/**
 * "Our PR", "Their issue", or for our comment "Our comment on their thread".
 * The ref follows it on screen.
 *
 * A comment is on a thread that already existed, so it reads "their thread".
 * `host` is that thread when the item lists it too: then it reads "their issue",
 * or "our PR" for a comment on a thread J5 opened.
 */
export function threadName(link: Pick<LinkView, "ownership" | "kind">, host?: Pick<LinkView, "ownership" | "kind"> | null): string {
  const side = threadSide(link);
  if (side === "our_comment") {
    if (!host) return "Our comment on their thread";
    return `Our comment on ${host.ownership === "ours" ? "our" : "their"} ${KIND_WORDS[host.kind]}`;
  }
  return `${side === "ours" ? "Our" : "Their"} ${KIND_WORDS[link.kind]}`;
}

const ROLE_WORDS: Record<LinkRole, string | null> = {
  primary: null,
  base: "base",
  covering: "covers this",
  fixes: "fixes this",
  related: "related"
};

const ROLE_HINTS: Record<LinkRole, string> = {
  primary: "The thread this item is offered on",
  base: "This item is stacked on it and waits for it",
  covering: "It may make this item unnecessary",
  fixes: "It fixes what this item reports",
  related: "Related to this item"
};

/** What the thread is to this item, in a word or two. Null for the primary thread. */
export function roleWord(role: LinkRole): string | null {
  return ROLE_WORDS[role];
}

export function roleHint(role: LinkRole): string {
  return ROLE_HINTS[role];
}

export type ThreadIcon = "prOpen" | "prDraft" | "prClosed" | "merged" | "issueOpen" | "issueClosed" | "discussion" | "comment";

export type ThreadState = { icon: ThreadIcon; tone: Tone; text: string };

const UNSYNCED_ICONS: Record<LinkKind, ThreadIcon> = {
  pr: "prOpen",
  issue: "issueOpen",
  comment: "comment",
  discussion: "discussion"
};

/**
 * The icon, tone and words for a thread's live state on GitHub.
 * A closed issue or discussion is not a bad sign; a PR closed unmerged is the one red state.
 * A comment has no state of its own, so it reports the thread it sits on.
 */
export function threadState(link: Pick<LinkView, "kind" | "state" | "isDraft">): ThreadState {
  if (link.state === null) return { icon: UNSYNCED_ICONS[link.kind], tone: "dim", text: "Not yet synced" };
  switch (link.kind) {
    case "pr":
      if (link.state === "merged") return { icon: "merged", tone: "merged", text: "Merged" };
      if (link.state === "closed") return { icon: "prClosed", tone: "closed", text: "Closed, not merged" };
      return link.isDraft ? { icon: "prDraft", tone: "draft", text: "Draft" } : { icon: "prOpen", tone: "open", text: "Open" };
    case "issue":
      return link.state === "open"
        ? { icon: "issueOpen", tone: "open", text: "Open" }
        : { icon: "issueClosed", tone: "merged", text: "Closed" };
    case "discussion":
      return link.state === "open"
        ? { icon: "discussion", tone: "open", text: "Open" }
        : { icon: "discussion", tone: "merged", text: "Closed" };
    case "comment":
      // The state is the thread's: the name already says "on their thread".
      if (link.state === "open") return { icon: "comment", tone: "open", text: "Open" };
      return { icon: "comment", tone: "merged", text: link.state === "merged" ? "Merged" : "Closed" };
  }
}

/**
 * The threads to show beside an item in a list: its primary thread, then what
 * it waits on or may be covered by. The list queries return no other links.
 */
export function listThreads(item: ListItem): LinkView[] {
  const threads: LinkView[] = [];
  if (item.primaryLink) threads.push(item.primaryLink);
  for (const link of item.dependencyLinks) {
    if (link.id !== item.primaryLink?.id) threads.push(link);
  }
  return threads;
}

/**
 * For our comment: the thread it sits on, when the item lists that thread too.
 * Null when the item does not list it.
 */
export function commentHost(comment: LinkView, links: readonly LinkView[]): LinkView | null {
  if (threadSide(comment) !== "our_comment") return null;
  return (
    links.find(
      (link) => link.id !== comment.id && link.kind !== "comment" && link.repo === comment.repo && link.number === comment.number
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// CI, review and the review bot
// ---------------------------------------------------------------------------

export type Signal = { icon: "checkCircleFill" | "xCircleFill" | "dotFill" | "check" | "fileDiff" | "eye"; tone: Tone; text: string };

const CI_SIGNALS: Record<GhCi, Signal> = {
  success: { icon: "checkCircleFill", tone: "open", text: "CI passing" },
  failure: { icon: "xCircleFill", tone: "closed", text: "CI failing" },
  pending: { icon: "dotFill", tone: "pending", text: "CI running" }
};

export function ciSignal(ci: GhCi): Signal {
  return CI_SIGNALS[ci];
}

const REVIEW_SIGNALS: Record<GhReviewDecision, Signal> = {
  approved: { icon: "check", tone: "open", text: "Review approved" },
  changes_requested: { icon: "fileDiff", tone: "closed", text: "Changes requested" },
  review_required: { icon: "eye", tone: "dim", text: "Review required" }
};

export function reviewSignal(decision: GhReviewDecision): Signal {
  return REVIEW_SIGNALS[decision];
}

/** Macroscope's verdict is free text. "Approved at <sha>" is its yes; "Not approved" its no; anything else is pending a person. */
export function macroscopeSignal(verdict: string): Signal {
  const text = verdict.trim().toLowerCase();
  if (text.startsWith("approved")) return { icon: "check", tone: "open", text: `Macroscope: ${verdict}` };
  if (text.startsWith("not approved")) return { icon: "fileDiff", tone: "closed", text: `Macroscope: ${verdict}` };
  return { icon: "eye", tone: "dim", text: `Macroscope: ${verdict}` };
}

// ---------------------------------------------------------------------------
// Stages, waiting and outcomes
// ---------------------------------------------------------------------------

export type StageIcon = "telescope" | "beaker" | "gitBranch" | "hourglass" | "pencil" | "checklist" | "paperAirplane" | "archive";

const STAGE_ICONS: Record<Stage, StageIcon> = {
  found: "telescope",
  validating: "beaker",
  deciding: "gitBranch",
  held: "hourglass",
  preparing: "pencil",
  approving: "checklist",
  offered: "paperAirplane",
  closed: "archive"
};

export function stageIcon(stage: Stage): StageIcon {
  return STAGE_ICONS[stage];
}

/** The two stages that wait on Jackson. */
export function stageWaitsOnJackson(stage: Stage): boolean {
  return stage === "deciding" || stage === "approving";
}

const WAITING_WORDS: Record<WaitingOn, string> = {
  jackson: "Jackson",
  maintainer: "a maintainer",
  ci: "CI",
  base_pr: "its base PR",
  covering_pr: "a covering PR",
  giveback_agent: "the giveback agent",
  upstream_advance: "an upstream advance",
  nobody: "nobody"
};

/** "a maintainer", "its base PR": reads after "Waits on". */
export function waitingWords(waitingOn: WaitingOn): string {
  return WAITING_WORDS[waitingOn];
}

export type OutcomeMark = { icon: "merged" | "checkCircle" | "skip" | "xCircle"; tone: Tone };

const OUTCOME_MARKS: Record<Outcome, OutcomeMark> = {
  merged: { icon: "merged", tone: "merged" },
  fixed_by_maintainer_pr: { icon: "checkCircle", tone: "open" },
  taken_over: { icon: "checkCircle", tone: "open" },
  covered_by_contributor: { icon: "checkCircle", tone: "open" },
  fixed_upstream: { icon: "checkCircle", tone: "open" },
  not_a_giveback: { icon: "skip", tone: "dim" },
  parked: { icon: "skip", tone: "dim" },
  dropped: { icon: "skip", tone: "dim" },
  closed_by_upstream: { icon: "xCircle", tone: "closed" }
};

/** Merged; fixed some other way; not pursued; or closed by upstream. The outcome's own label always sits beside it. */
export function outcomeMark(outcome: Outcome): OutcomeMark {
  return OUTCOME_MARKS[outcome];
}

/** How many items are in each stage, for the stage filter. */
export function stageCounts(items: readonly ListItem[]): Map<Stage, number> {
  const counts = new Map<Stage, number>();
  for (const item of items) counts.set(item.stage, (counts.get(item.stage) ?? 0) + 1);
  return counts;
}

/** Consecutive items of one stage, in the order given. The list is sorted by stage first. */
export function groupByStage(items: readonly ListItem[]): { stage: Stage; items: ListItem[] }[] {
  const groups: { stage: Stage; items: ListItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.stage === item.stage) last.items.push(item);
    else groups.push({ stage: item.stage, items: [item] });
  }
  return groups;
}
