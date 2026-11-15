// The marks that state one fact about an item or an upstream thread: which side
// of the fork a thread is on, its live state, CI and review, the stage, what an
// item waits on, and its outcome. Each is an icon with words beside it or an
// accessible name on it; colour only repeats what the shape and the words say.

import type { ComponentChildren } from "preact";
import type { LinkView } from "../../shared/api";
import {
  CHANGE_KIND_DESCRIPTIONS,
  CHANGE_KIND_LABELS,
  OUTCOME_LABELS,
  STAGE_LABELS,
  type ChangeKind,
  type FollowUpState,
  type Outcome,
  type Stage,
  type WaitingOn
} from "../../shared/enums";
import { closingClock, takeoverState, type TextApproval } from "../../shared/upstreamRules";
import { fullRef, shortRef } from "../lib/format";
import {
  ciSignal,
  clockWords,
  macroscopeSignal,
  outcomeMark,
  reviewSignal,
  roleHint,
  roleWord,
  stageIcon,
  takeoverWords,
  textApprovalWords,
  threadName,
  threadSide,
  threadState,
  waitingWords,
  type Signal,
  type Tone
} from "../lib/present";
import { Icon } from "./icons";
import { ExternalLink, FOCUS, REF, TEXT_DIM, TONE_TEXT, YOU_TAG, cx, useNowValue } from "./ui";

// ---------------------------------------------------------------------------
// Ours or theirs
// ---------------------------------------------------------------------------

// A filled block is ours. A hollow one is theirs. The icon inside is the
// thread's kind and state, in GitHub's own shapes.
const GLYPH_OURS: Record<Tone, string> = {
  open: "bg-(--open) text-(color:--card)",
  merged: "bg-(--merged) text-(color:--card)",
  closed: "bg-(--closed) text-(color:--card)",
  draft: "bg-(--draft) text-(color:--card)",
  pending: "bg-(--pending) text-(color:--card)",
  dim: "bg-(--dim) text-(color:--card)"
};

const GLYPH_THEIRS: Record<Tone, string> = {
  open: "border-[1.5px] border-(color:--open) text-(color:--open)",
  merged: "border-[1.5px] border-(color:--merged) text-(color:--merged)",
  closed: "border-[1.5px] border-(color:--closed) text-(color:--closed)",
  draft: "border-[1.5px] border-(color:--draft) text-(color:--draft)",
  pending: "border-[1.5px] border-(color:--pending) text-(color:--pending)",
  dim: "border-[1.5px] border-(color:--dim) text-(color:--dim)"
};

/** The block alone. `ours` fills it. */
export function SideGlyph({ ours, tone, children }: { ours: boolean; tone: Tone; children: ComponentChildren }) {
  return (
    <span
      className={cx(
        "inline-grid size-[1.375rem] shrink-0 place-items-center rounded-[0.3125rem]",
        ours ? GLYPH_OURS[tone] : GLYPH_THEIRS[tone]
      )}
    >
      {children}
    </span>
  );
}

/**
 * One upstream thread: the ours-or-theirs block, "Our PR" or "Their issue", the
 * ref, and its live state in words, linking out to GitHub. `role` adds what the
 * thread is to the item ("covers this"). `host`, for our comment, is the thread
 * it sits on when the item lists it.
 */
export function ThreadToken({
  link,
  host = null,
  role = false,
  full = false
}: {
  link: LinkView;
  host?: LinkView | null;
  role?: boolean;
  /** "pingdotgg/t3code#33420" in place of "t3code#33420". */
  full?: boolean;
}) {
  const live = threadState(link);
  const ours = threadSide(link) !== "theirs";
  const word = role ? roleWord(link.role) : null;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 align-middle text-sm leading-5">
      <ExternalLink
        className={cx(FOCUS, "group inline-flex min-w-0 items-start gap-1.5 rounded-sm")}
        href={link.url}
        title={`${fullRef(link.repo, link.number)}${link.title ? `: ${link.title}` : ""}`}
      >
        <SideGlyph ours={ours} tone={live.tone}>
          <Icon name={live.icon} size={14} />
        </SideGlyph>
        <span className="min-w-0">
          <span className={ours ? "font-semibold" : undefined}>{threadName(link, host)}</span>{" "}
          {/* The ref and its state never part: when the token wraps, they move to the next line together. */}
          <span className="whitespace-nowrap">
            <span className={cx(REF, "underline decoration-(color:--edge) underline-offset-2 group-hover:decoration-(color:--ink)")}>
              {full ? fullRef(link.repo, link.number) : shortRef(link.repo, link.number)}
            </span>{" "}
            <span className={cx("font-medium", TONE_TEXT[live.tone])}>{live.text}</span>
          </span>
        </span>
      </ExternalLink>
      {word ? (
        <span className={cx("whitespace-nowrap", TEXT_DIM)} title={roleHint(link.role)}>
          {word}
        </span>
      ) : null}
    </span>
  );
}

/** The key to the block: filled is ours, hollow is theirs. Small enough to sit in a column heading. */
export function SideKey() {
  return (
    <span className="inline-flex items-center gap-x-2.5 whitespace-nowrap">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="inline-grid size-3.5 place-items-center rounded-[0.1875rem] bg-(--dim) text-(color:--card)">
          <Icon name="prOpen" size={10} />
        </span>
        ours
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="inline-grid size-3.5 place-items-center rounded-[0.1875rem] border border-(color:--dim)">
          <Icon name="prOpen" size={10} />
        </span>
        theirs
      </span>
    </span>
  );
}

/** Shown in place of a thread when an item has none of ours. */
export function NoThread() {
  return <span className={cx("text-sm", TEXT_DIM)}>Nothing posted</span>;
}

// ---------------------------------------------------------------------------
// CI, review, the review bot and triage
// ---------------------------------------------------------------------------

function SignalMark({ signal, short }: { signal: Signal; short: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm leading-5" title={signal.text}>
      <Icon className={TONE_TEXT[signal.tone]} name={signal.icon} size={14} />
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{signal.text}</span>
    </span>
  );
}

/**
 * The clock upstream's bot has running on one of our open PRs: what it is and
 * when, in plain words, with the rule in the tooltip. It carries the weight of
 * a failing check and no more. Renders nothing when no clock is running.
 */
export function ClosingClockMark({ link }: { link: LinkView }) {
  const now = useNowValue();
  const clock = closingClock(link, now);
  if (!clock) return null;
  const words = clockWords(clock, link.repo, now);
  return (
    <span className="inline-flex min-w-0 items-start gap-1 text-sm leading-5" title={words.title}>
      <Icon className={cx("mt-[0.1875rem]", TONE_TEXT[words.tone])} name="clock" size={14} />
      {/* The sentence wraps inside a narrow column. */}
      <span className="min-w-0 break-words">{words.text}</span>
    </span>
  );
}

/**
 * What upstream's takeover pipeline is doing with one of our open PRs. While a
 * push would stop the pipeline it is a notice, outlined and bold: the one mark
 * in the row that says "do nothing". Stopped, it has the weight of a failing
 * check; waiting on a maintainer, it is quiet. `words` gives the full sentence.
 * Renders nothing when the PR carries no pipeline label.
 */
export function TakeoverMark({ link, words = false }: { link: LinkView; words?: boolean }) {
  const state = takeoverState(link);
  if (!state) return null;
  const mark = takeoverWords(state, link.pipelineMarker);
  return (
    <span
      className={cx(
        "inline-flex min-w-0 items-start gap-1 text-sm leading-5",
        mark.strong && "rounded border border-(color:--ink) px-1.5 font-semibold"
      )}
      title={mark.title}
    >
      <Icon className={cx("mt-[0.1875rem]", TONE_TEXT[mark.tone])} name={mark.icon} size={14} />
      <span className="min-w-0 break-words">{words ? state.text : state.short}</span>
    </span>
  );
}

/**
 * The live signals of a thread, as a wrapping row: the takeover pipeline's
 * state and a closing clock when there is one, then CI, review decision, the
 * review bot's verdict and the triage-board place. `words` spells each one out;
 * the clock is always in words. Renders nothing when the thread has none.
 */
export function ThreadSignals({ link, words = false, className }: { link: LinkView; words?: boolean; className?: string }) {
  const now = useNowValue();
  const clock = closingClock(link, now) !== null;
  const takeover = takeoverState(link) !== null;
  const ci = link.ci ? ciSignal(link.ci) : null;
  const review = link.reviewDecision ? reviewSignal(link.reviewDecision) : null;
  const macroscope = link.macroscopeVerdict ? macroscopeSignal(link.macroscopeVerdict) : null;
  const triage = link.triageBucket !== null || link.triageRank !== null;
  if (!takeover && !clock && !ci && !review && !macroscope && !triage) return null;
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-3 gap-y-0.5", className)}>
      {takeover ? (
        <li className="min-w-0">
          <TakeoverMark link={link} words={words} />
        </li>
      ) : null}
      {clock ? (
        <li className="min-w-0">
          <ClosingClockMark link={link} />
        </li>
      ) : null}
      {ci ? (
        <li>
          <SignalMark short={words ? ci.text : "CI"} signal={ci} />
        </li>
      ) : null}
      {review ? (
        <li>
          <SignalMark short={words ? review.text : "Review"} signal={review} />
        </li>
      ) : null}
      {macroscope ? (
        <li>
          <SignalMark short={words ? macroscope.text : "Macroscope"} signal={macroscope} />
        </li>
      ) : null}
      {triage ? (
        <li
          className="inline-flex min-w-0 items-start gap-1 text-sm leading-5"
          title="Where upstream's triage board has this thread: its bucket, and its rank in the bucket"
        >
          <Icon className={cx("mt-[0.1875rem]", TEXT_DIM)} name="project" size={14} />
          {/* A bucket name is free text and can be long: it wraps inside its column. */}
          <span className="min-w-0 break-words">
            Triage: {link.triageBucket ?? "unsorted"}
            {link.triageRank !== null ? <span className="tabular-nums"> #{link.triageRank}</span> : null}
          </span>
        </li>
      ) : null}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Stage, waiting, outcome
// ---------------------------------------------------------------------------

/** The stage as an icon and its name. `hot` gives it the amber of something that waits on Jackson. */
export function StageTag({ stage, hot = false }: { stage: Stage; hot?: boolean }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap text-sm leading-5",
        hot && cx(YOU_TAG, "rounded px-1.5 font-semibold")
      )}
    >
      <Icon className={hot ? undefined : TEXT_DIM} name={stageIcon(stage)} size={14} />
      {STAGE_LABELS[stage]}
    </span>
  );
}

/** "Waits on a maintainer". Amber, with the person icon, only when that is Jackson. */
export function Waiting({
  waitingOn,
  bare = false,
  quiet = false
}: {
  waitingOn: WaitingOn;
  /** The name alone, for under a "Waiting on" heading. */
  bare?: boolean;
  /** Dimmed, for the wait a list's items share by default. */
  quiet?: boolean;
}) {
  if (waitingOn === "jackson") {
    return (
      <span className={cx(YOU_TAG, "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 text-sm font-semibold leading-5")}>
        <Icon name="person" size={14} />
        {bare ? "Jackson" : "Waits on Jackson"}
      </span>
    );
  }
  const words = waitingWords(waitingOn);
  return (
    <span className={cx("text-sm leading-5", quiet && TEXT_DIM)}>
      {bare ? words.charAt(0).toUpperCase() + words.slice(1) : `Waits on ${words}`}
    </span>
  );
}

/** An open ask as an amber tag: the instruction itself, the same words the queue uses. It wraps when it is long. */
export function AskTag({ children }: { children: ComponentChildren }) {
  return (
    <span className={cx(YOU_TAG, "inline-flex max-w-full items-start gap-1 rounded px-1.5 py-px text-sm font-semibold leading-5")}>
      <Icon className="mt-[0.1875rem]" name="person" size={14} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  const mark = outcomeMark(outcome);
  return (
    <span className="inline-flex items-start gap-1 text-sm leading-5">
      <Icon className={cx("mt-[0.1875rem]", TONE_TEXT[mark.tone])} name={mark.icon} size={14} />
      <span>{OUTCOME_LABELS[outcome]}</span>
    </span>
  );
}

/**
 * Bug, behaviour change or feature: the verdict under upstream's own test, as a
 * small outlined tag, the mark the item page uses for what a thread is to an item.
 * Renders nothing when no verdict is recorded, which is always so for an undisclosed item.
 */
export function ChangeKindTag({ kind }: { kind: ChangeKind | null }) {
  if (!kind) return null;
  return (
    <span
      className="whitespace-nowrap rounded border border-(color:--edge) px-1.5 text-xs leading-5"
      title={`Kind of change: ${CHANGE_KIND_DESCRIPTIONS[kind]}`}
    >
      {CHANGE_KIND_LABELS[kind]}
    </span>
  );
}

/** Whether the text of a queued item's upstream post is approved. Amber only when it waits on Jackson. */
export function TextApprovalMark({ text }: { text: TextApproval }) {
  const words = textApprovalWords(text);
  if (text === "awaiting") {
    return (
      <span className={cx(YOU_TAG, "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 text-sm font-semibold leading-5")} title={words.title}>
        <Icon name="person" size={14} />
        {words.text}
      </span>
    );
  }
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap text-sm leading-5", text === "none" && TEXT_DIM)} title={words.title}>
      {text === "approved" ? <Icon className={TONE_TEXT.open} name="check" size={14} /> : null}
      {words.text}
    </span>
  );
}

/** The J5-side clean-up after a closed outcome. Nothing is shown when none is owed. */
export function FollowUp({ state }: { state: FollowUpState | null }) {
  if (state === "owed") return <span className="whitespace-nowrap text-sm font-semibold leading-5">J5 follow-up owed</span>;
  if (state === "done") return <span className={cx("whitespace-nowrap text-sm leading-5", TEXT_DIM)}>J5 follow-up done</span>;
  return null;
}

/** Raised by the server when a link merged, closed, reopened, began failing CI, was put on a closing clock, or moved in upstream's pipeline. */
export function UpstreamChanged({ note }: { note: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold leading-5" title={note ?? undefined}>
      <Icon name="alert" size={14} />
      Changed upstream
    </span>
  );
}
