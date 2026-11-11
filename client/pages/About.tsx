// How it works: the process in plain words, and the key to every mark the other pages use.

import type { ComponentChildren } from "preact";
import { MAIN_PATH_STAGES, STAGE_LABELS, type Stage } from "../../shared/enums";
import { formatItemId } from "../../shared/itemId";
import { Icon, type IconName } from "../components/icons";
import { SideGlyph } from "../components/marks";
import { ITEM_ID, PRIVATE_BLOCK, SERIF, TEXT_DIM, TONE_TEXT, YOU_TAG, cx } from "../components/ui";
import { useTitle } from "../data";
import { stageIcon, type Tone } from "../lib/present";


/** One line per stage, written for a visitor. */
const STAGE_PROSE: Record<Stage, string> = {
  found: "A possible fix is recorded.",
  validating: "It is checked against current upstream code and searched for duplicates.",
  deciding: "It is real. Jackson chooses how to offer it, or not to.",
  held: "It is real, and there is nothing to offer yet: someone else's open upstream change already covers it, or has to land first.",
  preparing: "The branch, tests, evidence and the text of the post are produced.",
  approving: "Jackson reads the exact text and approves it.",
  offered: "It is posted upstream as a pull request, issue, comment or discussion.",
  closed: "It has an outcome: merged, fixed another way, declined, parked or dropped."
};

function Heading({ children }: { children: ComponentChildren }) {
  return <h2 className={cx(SERIF, "mt-7 text-lg font-bold leading-6 first:mt-0")}>{children}</h2>;
}

function Key({ mark, children }: { mark: ComponentChildren; children: ComponentChildren }) {
  return (
    <li className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-start gap-x-3">
      <span className="flex min-h-6 flex-wrap items-center gap-1">{mark}</span>
      <span>{children}</span>
    </li>
  );
}

function Tinted({ name, tone }: { name: IconName; tone: Tone }) {
  return <Icon className={TONE_TEXT[tone]} name={name} />;
}

export function AboutPage() {
  useTitle("How it works");
  return (
    <article className="pb-4 pt-4 text-[0.9375rem] leading-relaxed">
      <h1 className={cx(SERIF, "text-2xl font-bold leading-8")}>How it works</h1>
      <p className="mt-2 max-w-[44rem]">
        J5 Code is a fork of T3 Code that Jackson and others maintain. Keeping a fork current means reading and running the
        upstream code every day, and that turns up bugs. When a fix would be useful upstream too, it is offered back.
        This site is the record of those offers.
      </p>

      <div className="mt-6 grid gap-x-12 gap-y-8 lg:grid-cols-2">
        <section className="max-w-[40rem]">
          <Heading>The stages</Heading>
          <ol className="mt-2 space-y-1.5">
            {MAIN_PATH_STAGES.map((stage) => (
              <li className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-1" key={stage}>
                <Icon className={cx("mt-1", TEXT_DIM)} name={stageIcon(stage)} />
                <span>
                  <span className="font-semibold">{STAGE_LABELS[stage]}.</span> {STAGE_PROSE[stage]}
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-1">
            <Icon className={cx("mt-1", TEXT_DIM)} name={stageIcon("held")} />
            <span>
              <span className="font-semibold">{STAGE_LABELS.held}</span> is a side stop, not a step. {STAGE_PROSE.held} A
              held item waits on that change, not on Jackson or the agent. When the change merges or is dropped, the
              item closes or goes back onto the path.
            </span>
          </p>
          <p className="mt-2">An item can move back a stage, for example when upstream changes underneath it.</p>
          <p className="mt-2">
            Deciding and Approving wait on Jackson. Everything that waits on him is marked in{" "}
            <span className={cx(YOU_TAG, "rounded px-1 font-semibold")}>amber</span>, with the action it needs and how
            long it has waited.
          </p>
        </section>

        <section className="max-w-[40rem]">
          <Heading>Reading the marks</Heading>
          <ul className="mt-2 space-y-2">
            <Key
              mark={
                <SideGlyph ours tone="open">
                  <Icon name="prOpen" size={14} />
                </SideGlyph>
              }
            >
              <span className="font-semibold">Ours.</span> A filled block is a pull request, issue or discussion that J5
              opened, or J5's comment on a thread that already existed.
            </Key>
            <Key
              mark={
                <SideGlyph ours={false} tone="open">
                  <Icon name="prOpen" size={14} />
                </SideGlyph>
              }
            >
              <span className="font-semibold">Theirs.</span> A hollow block is someone else's thread: one that covers
              the same problem, one ours is stacked on, or one that fixed it.
            </Key>
            <Key
              mark={
                <>
                  <Tinted name="prOpen" tone="open" />
                  <Tinted name="prDraft" tone="draft" />
                  <Tinted name="merged" tone="merged" />
                  <Tinted name="prClosed" tone="closed" />
                </>
              }
            >
              A pull request that is open, a draft, merged, or closed without merging.
            </Key>
            <Key
              mark={
                <>
                  <Tinted name="issueOpen" tone="open" />
                  <Tinted name="issueClosed" tone="merged" />
                  <Tinted name="discussion" tone="open" />
                  <Tinted name="comment" tone="open" />
                </>
              }
            >
              An open issue, a closed issue, a discussion, and a comment.
            </Key>
            <Key
              mark={
                <>
                  <Tinted name="checkCircleFill" tone="open" />
                  <Tinted name="xCircleFill" tone="closed" />
                  <Tinted name="dotFill" tone="pending" />
                </>
              }
            >
              CI passing, failing, and still running.
            </Key>
            <Key
              mark={
                <>
                  <Tinted name="check" tone="open" />
                  <Tinted name="fileDiff" tone="closed" />
                  <Tinted name="eye" tone="dim" />
                </>
              }
            >
              A review that approved, asked for changes, or is still required. The same three marks give the review
              bot's verdict.
            </Key>
            <Key mark={<span className={cx(ITEM_ID, "text-xs")}>{formatItemId(12)}</span>}>
              An item's ID. Each item takes the next number when it is recorded and keeps it, so the ID is a short,
              stable way to name the item. An undisclosed candidate has one too.
            </Key>
            <Key mark={<span className={cx(PRIVATE_BLOCK, "text-sm")}>dashed</span>}>
              A dashed edge or underline marks what only the signed-in owner is sent. Visitors never receive it.
            </Key>
          </ul>
          <p className="mt-3">
            Live state comes from GitHub. "Active" is the last comment or review by anyone other than Jackson, bots
            excluded; "waiting" counts from when the current wait began. An offered item waits on a maintainer unless
            its row says otherwise. An item's age counts from when it was found.
          </p>
        </section>

      </div>
    </article>
  );
}
