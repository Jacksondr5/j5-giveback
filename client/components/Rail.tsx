// The pipeline drawn as a line with a stop per stage, and Held as a branch off
// it. The overview uses it with a count at each stop; an item page uses it to
// show where the item is.

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
  const hot = stageWaitsOnJackson(stop.stage);
  const current = stop.mark === "current";
  const held = stop.stage === "held";
  return (
    <>
      <span
        className={cx(
          "block truncate text-[0.8125rem] leading-5",
          current ? "font-bold" : stop.mark === "ahead" ? TEXT_DIM : undefined
        )}
      >
        {STAGE_LABELS[stop.stage]}
      </span>
      {/* The dot sits on the line. On a phone the stops wrap and there is no line; a count needs no dot there. */}
      <span className={cx("h-5 items-center", stop.mark ? "flex" : "hidden sm:flex", held && "sm:order-first")}>
        <Dot stop={stop} />
      </span>
      {stop.count !== undefined ? (
        <span className={cx(SERIF, "block text-2xl font-bold leading-7 tabular-nums", hot && !held && "sm:mt-0.5")}>{stop.count}</span>
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
    <ol aria-label={label} className="grid grid-cols-4 gap-x-1 gap-y-3 sm:grid-cols-7 sm:gap-x-0 sm:gap-y-0">
      {stops.map((stop) => {
        const held = stop.stage === "held";
        const hot = stageWaitsOnJackson(stop.stage) && (stop.mark === undefined || stop.mark === "current");
        const body = <StopBody stop={stop} />;
        const frame = cx(
          "relative block min-w-0 rounded-sm px-1 sm:px-2",
          // Phone: an amber block for Jackson's stages, since there is no line to carry the dot.
          hot && "max-sm:bg-(--you-bg) max-sm:text-(color:--you-ink)",
          held && "sm:ml-[25%] sm:flex sm:w-fit sm:items-center sm:gap-x-2 sm:pl-5"
        );
        return (
          <li
            aria-current={stop.mark === "current" ? "step" : undefined}
            className={cx(
              "relative min-w-0",
              held ? "sm:col-span-2 sm:col-start-3 sm:row-start-2" : cx(COLUMN[stop.stage], "sm:row-start-1"),
              // The line: a rule through the dots, from the first stop to the last.
              !held &&
                "sm:before:absolute sm:before:top-[1.875rem] sm:before:h-0.5 sm:before:-translate-y-1/2 sm:before:bg-(--edge) sm:before:content-['']",
              !held && (stop.stage === FIRST ? "sm:before:left-4" : "sm:before:left-0"),
              !held && (stop.stage === LAST ? "sm:before:right-[calc(100%-1rem)]" : "sm:before:right-0"),
              // The branch: an elbow that leaves the line halfway between Deciding and the next stop, and turns to Held.
              held &&
                "sm:before:absolute sm:before:left-1/4 sm:before:w-3.5 sm:before:rounded-bl-lg sm:before:border-b-2 sm:before:border-l-2 sm:before:border-(color:--edge) sm:before:content-['']",
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
