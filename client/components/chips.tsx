// Chips that state one fact about an item or an upstream link.
// Each enumeration maps to its words and its tone here, in one place.

import type { LinkView } from "../../shared/api";
import {
  GH_STATE_LABELS,
  OUTCOME_LABELS,
  STAGE_LABELS,
  type FollowUpState,
  type GhCi,
  type GhReviewDecision,
  type LinkRole,
  type Outcome,
  type Stage,
  type WaitingOn
} from "../../shared/enums";
import { fullRef, shortKind } from "../lib/format";
import { Chip, type ChipTone } from "./ui";

const WAITING_PHRASES: Record<WaitingOn, string> = {
  jackson: "Needs Jackson",
  maintainer: "Waiting on a maintainer",
  ci: "Waiting on CI",
  base_pr: "Waiting on its base PR",
  covering_pr: "Waiting on a covering PR",
  giveback_agent: "Waiting on the giveback agent",
  upstream_advance: "Waiting on an upstream advance",
  nobody: "Waiting on nobody"
};

export function waitingPhrase(waitingOn: WaitingOn): string {
  return WAITING_PHRASES[waitingOn];
}

/** What the item waits on. Amber only when that is Jackson. */
export function WaitingChip({ waitingOn }: { waitingOn: WaitingOn }) {
  return <Chip tone={waitingOn === "jackson" ? "you" : "neutral"}>{WAITING_PHRASES[waitingOn]}</Chip>;
}

/** The two stages that wait on Jackson. */
export function stageWaitsOnJackson(stage: Stage): boolean {
  return stage === "deciding" || stage === "approving";
}

export function StageChip({ stage }: { stage: Stage }) {
  return <Chip tone="neutral">{STAGE_LABELS[stage]}</Chip>;
}

const CI: Record<GhCi, { text: string; tone: ChipTone }> = {
  success: { text: "CI passing", tone: "ok" },
  failure: { text: "CI failing", tone: "bad" },
  pending: { text: "CI running", tone: "neutral" }
};

export function CiChip({ ci }: { ci: GhCi }) {
  return <Chip tone={CI[ci].tone}>{CI[ci].text}</Chip>;
}

const REVIEW: Record<GhReviewDecision, { text: string; tone: ChipTone }> = {
  approved: { text: "Review: approved", tone: "ok" },
  changes_requested: { text: "Review: changes requested", tone: "bad" },
  review_required: { text: "Review: required", tone: "neutral" }
};

export function ReviewChip({ decision }: { decision: GhReviewDecision }) {
  return <Chip tone={REVIEW[decision].tone}>{REVIEW[decision].text}</Chip>;
}

/** The words and tone for a link's live state. A closed issue is not a bad sign; a PR closed unmerged is. */
export function linkState(link: LinkView): { text: string; tone: ChipTone } | null {
  if (link.state === null) return null;
  if (link.state === "merged") return { text: GH_STATE_LABELS.merged, tone: "ok" };
  if (link.state === "closed") {
    return { text: link.kind === "pr" ? "Closed, not merged" : GH_STATE_LABELS.closed, tone: link.kind === "pr" ? "bad" : "neutral" };
  }
  return { text: link.isDraft ? "Open, draft" : GH_STATE_LABELS.open, tone: "neutral" };
}

export function LinkStateChip({ link }: { link: LinkView }) {
  const state = linkState(link);
  return state ? <Chip tone={state.tone}>{state.text}</Chip> : <Chip tone="neutral">Not yet synced</Chip>;
}

export function MacroscopeChip({ verdict }: { verdict: string }) {
  return <Chip tone="neutral">Macroscope: {verdict}</Chip>;
}

export function TriageChip({ bucket, rank }: { bucket: string | null; rank: number | null }) {
  if (bucket === null && rank === null) return null;
  return (
    <Chip tone="neutral">
      Triage: {bucket ?? "unsorted"}
      {rank !== null ? <span className="tabular-nums">&nbsp;· #{rank}</span> : null}
    </Chip>
  );
}

const OUTCOME_TONES: Record<Outcome, ChipTone> = {
  merged: "ok",
  fixed_by_maintainer_pr: "neutral",
  taken_over: "neutral",
  covered_by_contributor: "neutral",
  fixed_upstream: "neutral",
  not_a_giveback: "neutral",
  parked: "neutral",
  dropped: "neutral",
  closed_by_upstream: "bad"
};

export function OutcomeChip({ outcome }: { outcome: Outcome }) {
  return <Chip tone={OUTCOME_TONES[outcome]}>{OUTCOME_LABELS[outcome]}</Chip>;
}

/** The J5-side clean-up after a closed outcome. Nothing is shown when none is owed. */
export function FollowUpChip({ state }: { state: FollowUpState | null }) {
  if (state === "owed") return <Chip tone="strong">J5 follow-up owed</Chip>;
  if (state === "done") return <Chip tone="neutral">J5 follow-up done</Chip>;
  return null;
}

/** Raised by the server when a link merged, closed, reopened or began failing CI. */
export function UpstreamChangedChip({ note }: { note: string | null }) {
  return (
    <Chip title={note ?? undefined} tone="strong">
      Changed upstream
    </Chip>
  );
}

/** Marks an item the public sees only as an undisclosed candidate. Owner view only. */
export function NotPublicChip() {
  return <Chip tone="owner">Owner only: not public</Chip>;
}

const DEPENDENCY_WORDS: Record<LinkRole, string> = {
  primary: "Primary",
  base: "Base",
  covering: "Covering",
  fixes: "Fixes",
  related: "Related"
};

/** A base or covering link with its live state, linking out to GitHub. */
export function DependencyChip({ link }: { link: LinkView }) {
  const state = linkState(link);
  return (
    <Chip href={link.url} title={link.title ?? fullRef(link.repo, link.number)} tone={state?.tone ?? "neutral"}>
      {DEPENDENCY_WORDS[link.role]} {shortKind(link.kind)}&nbsp;<span className="tabular-nums">#{link.number}</span>
      &nbsp;· {state ? state.text.toLowerCase() : "not yet synced"}
    </Chip>
  );
}
