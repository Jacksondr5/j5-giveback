// How it works: the process in plain words, for a visitor who has never seen it.

import type { ComponentChildren } from "preact";
import { STAGES, STAGE_LABELS, type Stage } from "../../shared/enums";
import { ExternalLink, TEXT_MUTED, cx } from "../components/ui";
import { useTitle } from "../data";

const CONTRIBUTING_URL = "https://github.com/pingdotgg/t3code/blob/main/CONTRIBUTING.md";

/** One line per stage, written for a visitor. */
const STAGE_PROSE: Record<Stage, string> = {
  found: "A possible fix is recorded.",
  validating: "It is checked against current upstream code and searched for duplicates.",
  deciding: "It is real. Jackson chooses how to offer it, or not to.",
  preparing: "The branch, tests, evidence and the text of the post are produced.",
  approving: "Jackson reads the exact text and approves it.",
  offered: "It is posted upstream as a pull request, issue, comment or discussion.",
  closed: "It has an outcome: merged, fixed another way, declined, parked or dropped."
};

function Heading({ children }: { children: ComponentChildren }) {
  return <h2 className="mt-7 text-xs font-semibold uppercase tracking-wider">{children}</h2>;
}

export function AboutPage() {
  useTitle("How it works");
  return (
    <article className="max-w-2xl text-[0.9375rem] leading-relaxed">
      <h1 className="mt-6 text-xl font-semibold tracking-tight">How it works</h1>
      <p className="mt-3">
        J5 Code is a fork of T3 Code that Jackson maintains. Keeping a fork current means reading and running the
        upstream code every day, and that turns up bugs. When a fix would be useful upstream too, it is offered back.
        This site is the record of those offers.
      </p>

      <Heading>The stages</Heading>
      <ol className="mt-2 space-y-1">
        {STAGES.map((stage, index) => (
          <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1" key={stage}>
            <span className={cx("tabular-nums", TEXT_MUTED)}>{index + 1}</span>
            <span>
              <span className="font-semibold">{STAGE_LABELS[stage]}.</span> {STAGE_PROSE[stage]}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2">An item can move back a stage, for example when upstream changes underneath it.</p>

      <Heading>The rules it follows</Heading>
      <p className="mt-2">
        Every offer to T3 Code follows its <ExternalLink href={CONTRIBUTING_URL}>CONTRIBUTING</ExternalLink> rules:
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>A small fix for an obvious bug goes straight to a pull request.</li>
        <li>A substantial bug goes through an issue first, for a maintainer to triage.</li>
        <li>A feature needs a maintainer's approval before any code is offered.</li>
        <li>One problem per pull request.</li>
        <li>Evidence is required: how the problem was established and how the change was checked.</li>
      </ul>

      <Heading>Who does the work</Heading>
      <p className="mt-2">
        AI agents do the work on Jackson's behalf: they find candidates, check them, and prepare the code and the
        text. Nothing is posted upstream until Jackson has approved it, and every post says who wrote it.
      </p>

      <Heading>What upstream owes</Heading>
      <p className="mt-2">
        Nothing. Maintainers may merge, rewrite, defer or decline anything offered, in their own time. The ages shown
        here measure this project's own waiting. They are not a request.
      </p>

      <Heading>Undisclosed candidates</Heading>
      <p className="mt-2">
        Some candidates are listed without a title. They are counted, and their details are withheld until they are
        offered upstream.
      </p>
    </article>
  );
}
