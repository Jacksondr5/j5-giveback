// The marks that state one fact about an item or an upstream thread: which side
// of the fork a thread is on, its live state, CI and review, the stage, what an
// item waits on, and its outcome. Each is an icon with words beside it or an
// accessible name on it; colour only repeats what the shape and the words say.

import type { ComponentChildren } from "preact";
import type { LinkView } from "../../shared/api";
import { OUTCOME_LABELS, STAGE_LABELS, type FollowUpState, type Outcome, type Stage, type WaitingOn } from "../../shared/enums";
import { fullRef, shortRef } from "../lib/format";
import {
  ciSignal,
  macroscopeSignal,
  outcomeMark,
  reviewSignal,
  roleHint,
  roleWord,
  stageIcon,
  threadName,
  threadSide,
  threadState,
  waitingWords,
  type Signal,
  type Tone
} from "../lib/present";
import { Icon } from "./icons";
import { ExternalLink, FOCUS, REF, TEXT_DIM, TONE_TEXT, YOU_TAG, cx } from "./ui";

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
 * One upstream thread: the ours-or-theirs block, "Our PR" or "Their issue", and
 * the ref, linking out to GitHub. `role` adds what the thread is to the item
 * ("covers this"); `state` adds its live state in words.
 */
export function ThreadToken({
  link,
  role = false,
  state = false,
  full = false
}: {
  link: LinkView;
  role?: boolean;
  state?: boolean;
  /** "pingdotgg/t3code#33420" in place of "t3code#33420". */
  full?: boolean;
}) {
  const live = threadState(link);
  const ours = threadSide(link) !== "theirs";
  const word = role ? roleWord(link.role) : null;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 align-middle text-[0.8125rem] leading-5">
      <ExternalLink
        className={cx(FOCUS, "group inline-flex min-w-0 items-center gap-1.5 rounded-sm")}
        href={link.url}
        title={`${fullRef(link.repo, link.number)}${link.title ? `: ${link.title}` : ""} (${live.text})`}
      >
        <SideGlyph ours={ours} tone={live.tone}>
          <Icon name={live.icon} size={14} />
        </SideGlyph>
        <span className="min-w-0 break-words">
          <span className={ours ? "font-semibold" : undefined}>{threadName(link)}</span>{" "}
          <span className={cx(REF, "underline decoration-(color:--edge) underline-offset-2 group-hover:decoration-(color:--ink)")}>
            {full ? fullRef(link.repo, link.number) : shortRef(link.repo, link.number)}
          </span>
          {state ? null : <span className="sr-only">, {live.text}</span>}
        </span>
      </ExternalLink>
      {state ? <span className={cx("whitespace-nowrap font-medium", TONE_TEXT[live.tone])}>{live.text}</span> : null}
      {word ? (
        <span className={cx("whitespace-nowrap", TEXT_DIM)} title={roleHint(link.role)}>
          {word}
        </span>
      ) : null}
    </span>
  );
}

/** Shown in place of a thread when an item has none of ours. */
export function NoThread() {
  return <span className={cx("text-[0.8125rem]", TEXT_DIM)}>Nothing posted</span>;
}

// ---------------------------------------------------------------------------
// CI, review, the review bot and triage
// ---------------------------------------------------------------------------

function SignalMark({ signal, short }: { signal: Signal; short: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[0.8125rem] leading-5" title={signal.text}>
      <Icon className={TONE_TEXT[signal.tone]} name={signal.icon} size={14} />
      <span aria-hidden="true">{short}</span>
      <span className="sr-only">{signal.text}</span>
    </span>
  );
}

/**
 * The live signals of a thread, as a wrapping row: CI, review decision, the
 * review bot's verdict and the triage-board place. `words` spells each one out.
 * Renders nothing when the thread has none.
 */
export function ThreadSignals({ link, words = false, className }: { link: LinkView; words?: boolean; className?: string }) {
  const ci = link.ci ? ciSignal(link.ci) : null;
  const review = link.reviewDecision ? reviewSignal(link.reviewDecision) : null;
  const macroscope = link.macroscopeVerdict ? macroscopeSignal(link.macroscopeVerdict) : null;
  const triage = link.triageBucket !== null || link.triageRank !== null;
  if (!ci && !review && !macroscope && !triage) return null;
  return (
    <ul className={cx("flex flex-wrap items-center gap-x-3 gap-y-0.5", className)}>
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
        <li className="whitespace-nowrap text-[0.8125rem] leading-5" title="Place on the upstream triage board">
          Triage {link.triageBucket ?? "unsorted"}
          {link.triageRank !== null ? <span className="tabular-nums"> #{link.triageRank}</span> : null}
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
        "inline-flex items-center gap-1 whitespace-nowrap text-[0.8125rem] leading-5",
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
      <span className={cx(YOU_TAG, "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 text-[0.8125rem] font-semibold leading-5")}>
        <Icon name="person" size={14} />
        {bare ? "Jackson" : "Waits on Jackson"}
      </span>
    );
  }
  const words = waitingWords(waitingOn);
  return (
    <span className={cx("text-[0.8125rem] leading-5", quiet && TEXT_DIM)}>
      {bare ? words.charAt(0).toUpperCase() + words.slice(1) : `Waits on ${words}`}
    </span>
  );
}

/** An open ask as a compact amber tag: the action it needs. */
export function AskTag({ children }: { children: ComponentChildren }) {
  return (
    <span className={cx(YOU_TAG, "inline-flex max-w-full items-center gap-1 rounded px-1.5 text-[0.8125rem] font-semibold leading-5")}>
      <Icon name="person" size={14} />
      <span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

export function OutcomeTag({ outcome }: { outcome: Outcome }) {
  const mark = outcomeMark(outcome);
  return (
    <span className="inline-flex items-start gap-1 text-[0.8125rem] leading-5">
      <Icon className={cx("mt-[0.1875rem]", TONE_TEXT[mark.tone])} name={mark.icon} size={14} />
      <span>{OUTCOME_LABELS[outcome]}</span>
    </span>
  );
}

/** The J5-side clean-up after a closed outcome. Nothing is shown when none is owed. */
export function FollowUp({ state }: { state: FollowUpState | null }) {
  if (state === "owed") return <span className="whitespace-nowrap text-[0.8125rem] font-semibold leading-5">J5 follow-up owed</span>;
  if (state === "done") return <span className={cx("whitespace-nowrap text-[0.8125rem] leading-5", TEXT_DIM)}>J5 follow-up done</span>;
  return null;
}

/** Raised by the server when a link merged, closed, reopened or began failing CI. */
export function UpstreamChanged({ note }: { note: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-[0.8125rem] font-semibold leading-5" title={note ?? undefined}>
      <Icon name="alert" size={14} />
      Changed upstream
    </span>
  );
}
