// The pipeline drawn as a line with a stop per stage, and Held as a branch off
// it. The overview uses it with a count at each stop; an item page uses it to
// show where the item is. Wide, the line runs across; on a phone it runs down.

import { Link } from "lakebed/client";
import { MAIN_PATH_STAGES, STAGE_DESCRIPTIONS, STAGE_LABELS, type Stage } from "../../shared/enums";
import { stageWaitsOnJackson } from "../lib/present";
import { Icon } from "./icons";
import { FOCUS, SERIF, TEXT_DIM, cx } from "./ui";

export type Stop = {
  stage: Stage;
  /** Overview: how many items are at this stop. */
  count?: number;
  /** Item page: whether the item is past this stop, at it, or has not reached it. */
  mark?: "passed" | "current" | "ahead";
  href?: string;
};

// Where each main-path stage sits on the line at the wide size. Written out so
// every class is complete.
const COLUMN: Record<Stage, string> = {
  found: "sm:col-start-1",
  validating: "sm:col-start-2",
  deciding: "sm:col-start-3",
  preparing: "sm:col-start-4",
  approving: "sm:col-start-5",
  offered: "sm:col-start-6",
  closed: "sm:col-start-7",
  held: "sm:col-start-3"
};

const FIRST = MAIN_PATH_STAGES[0];
const LAST = MAIN_PATH_STAGES[MAIN_PATH_STAGES.length - 1];

// The line is each stop's ::before. Down the left on a phone, across from sm.
const LINE = cx(
  "before:absolute before:bg-(--edge) before:content-['']",
  "max-sm:before:left-[1.0625rem] max-sm:before:w-0.5",
  "sm:before:top-[1.875rem] sm:before:h-0.5 sm:before:-translate-y-1/2"
);
const LINE_FIRST = "max-sm:before:top-1/2 max-sm:before:bottom-0 sm:before:left-4 sm:before:right-0";
const LINE_MIDDLE = "max-sm:before:top-0 max-sm:before:bottom-0 sm:before:left-0 sm:before:right-0";
const LINE_LAST = "max-sm:before:top-0 max-sm:before:bottom-1/2 sm:before:left-0 sm:before:right-[calc(100%-1rem)]";

// Held: on a phone the line passes it on the left (::before) and an elbow turns
// off to it (::after). Wide, the elbow (::before) leaves the line halfway
// between Deciding and the next stop.
const HELD_PHONE = cx(
  "max-sm:before:absolute max-sm:before:left-[1.0625rem] max-sm:before:top-0 max-sm:before:bottom-0 max-sm:before:w-0.5 max-sm:before:bg-(--edge) max-sm:before:content-['']",
  "max-sm:after:absolute max-sm:after:left-[1.0625rem] max-sm:after:top-0 max-sm:after:h-1/2 max-sm:after:w-5 max-sm:after:rounded-bl-lg max-sm:after:border-b-2 max-sm:after:border-l-2 max-sm:after:border-(color:--edge) max-sm:after:content-['']"
);
const HELD_WIDE =
  "sm:before:absolute sm:before:left-1/4 sm:before:w-3.5 sm:before:rounded-bl-lg sm:before:border-b-2 sm:before:border-l-2 sm:before:border-(color:--edge) sm:before:content-['']";

function Dot({ stop }: { stop: Stop }) {
  const hot = stageWaitsOnJackson(stop.stage);
  const current = stop.mark === "current";
  const ahead = stop.mark === "ahead";
  if (hot && (stop.mark === undefined || current)) {
    // The two stages that wait on Jackson carry the person icon on amber.
    return (
      <span className="relative z-10 grid size-5 place-items-center rounded-full bg-(--you-solid) text-[#2b1d00] ring-4 ring-(--card)">
        <Icon name="person" size={12} />
      </span>
    );
  }
  return (
    <span
      className={cx(
        "relative z-10 box-border block rounded-full ring-4 ring-(--card)",
        current ? "size-4 border-[5px] border-(color:--ink) bg-(--card)" : "size-3",
        !current && (ahead ? "border-2 border-(color:--edge) bg-(--card)" : "bg-(--ink)")
      )}
    />
  );
}

function StopBody({ stop }: { stop: Stop }) {
  const hot = stageWaitsOnJackson(stop.stage) && (stop.mark === undefined || stop.mark === "current");
  const current = stop.mark === "current";
  const held = stop.stage === "held";
  return (
    <>
      <span
        className={cx(
          "block min-w-0 truncate text-sm leading-5",
          current ? "font-bold" : stop.mark === "ahead" ? TEXT_DIM : undefined
        )}
      >
        {STAGE_LABELS[stop.stage]}
      </span>
      {/* The dot sits on the line: first in the row on a phone, between label and count when wide. */}
      <span className={cx("flex h-5 items-center max-sm:order-first max-sm:justify-center", held && "sm:order-first")}>
        <Dot stop={stop} />
      </span>
      {stop.count !== undefined ? (
        <span
          className={cx(
            SERIF,
            "block text-right text-xl font-bold leading-6 tabular-nums sm:text-left sm:text-2xl sm:leading-7",
            hot && !held && "sm:mt-0.5"
          )}
        >
          {stop.count}
        </span>
      ) : null}
      {stop.mark ? (
        <span className="sr-only">{stop.mark === "current" ? "now" : stop.mark === "passed" ? "passed" : "not reached"}</span>
      ) : null}
    </>
  );
}

/**
 * `stops` in pipeline order. Held, when present, branches off the line after
 * Deciding; without it the line is the seven main-path stages.
 */
export function Rail({ stops, label }: { stops: Stop[]; label: string }) {
  const counts = stops.some((stop) => stop.count !== undefined);
  return (
    <ol aria-label={label} className="grid grid-cols-1 sm:grid-cols-7">
      {stops.map((stop) => {
        const held = stop.stage === "held";
        const body = <StopBody stop={stop} />;
        const frame = cx(
          // Phone: dot, name, count in a row. Wide: name, dot, count stacked.
          "relative min-w-0 rounded-sm max-sm:grid max-sm:min-h-8 max-sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-1 max-sm:pr-2 sm:block sm:px-2",
          held && "max-sm:ml-6 sm:ml-[25%] sm:flex sm:w-fit sm:items-center sm:gap-x-2 sm:pl-5"
        );
        return (
          <li
            aria-current={stop.mark === "current" ? "step" : undefined}
            className={cx(
              "relative min-w-0",
              held ? "sm:col-span-2 sm:col-start-3 sm:row-start-2" : cx(COLUMN[stop.stage], "sm:row-start-1"),
              !held && LINE,
              !held && (stop.stage === FIRST ? LINE_FIRST : stop.stage === LAST ? LINE_LAST : LINE_MIDDLE),
              held && HELD_PHONE,
              held && HELD_WIDE,
              held && (counts ? "sm:before:-top-[2.5rem] sm:before:h-[3.375rem]" : "sm:mt-2 sm:before:-top-[1.125rem] sm:before:h-[1.75rem]")
            )}
            key={stop.stage}
            title={STAGE_DESCRIPTIONS[stop.stage]}
          >
            {stop.href ? (
              <Link className={cx(frame, FOCUS, "hover:bg-(--paper)")} to={stop.href}>
                {body}
              </Link>
            ) : (
              <div className={frame}>{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
