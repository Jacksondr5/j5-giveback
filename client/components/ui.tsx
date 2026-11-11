// Shared building blocks: surfaces, chips, links, ages and the loading, empty and error states.
//
// Every Tailwind class here is written out in full. Enumerations map to complete
// class strings (see CHIP_TONES); nothing builds a class name from a variable.

import { Link } from "lakebed/client";
import { Component, createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext } from "preact/hooks";
import { formatAge, formatDate, formatDateTime, isoTime } from "../lib/format";

/** Joins class strings, skipping the empty ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}

// Colour roles. Neutral stone surfaces; amber only for "needs Jackson";
// green and red only for upstream states, always beside a text label.
export const TEXT_MUTED = "text-stone-600 dark:text-stone-400";
export const SURFACE = "border border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-900";
export const DIVIDE = "divide-y divide-stone-200 dark:divide-stone-800";
export const FOCUS =
  "outline-offset-2 focus-visible:outline-2 focus-visible:outline-stone-900 dark:focus-visible:outline-stone-100";
export const LINK = cx(
  FOCUS,
  "rounded-sm underline decoration-stone-400 underline-offset-2 hover:decoration-stone-900 dark:decoration-stone-500 dark:hover:decoration-stone-100"
);
/** A title that is a link: no underline until hover, so a list of them stays calm. */
export const TITLE_LINK = cx(FOCUS, "rounded-sm font-medium hover:underline hover:underline-offset-2");
export const MONO = "font-mono text-xs";

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The current time, refreshed about once a minute, so ages stay true on an open tab. */
export const NowContext = createContext<number>(Date.now());

export function useNowValue(): number {
  return useContext(NowContext);
}

/** An age such as "11 d", with the exact date in its `title`. */
export function Age({
  at,
  prefix,
  suffix,
  label,
  className
}: {
  at: number;
  prefix?: string;
  suffix?: string;
  /** What the date is, for the tooltip: "Asked", "Found". */
  label?: string;
  className?: string;
}) {
  const now = useNowValue();
  const exact = formatDateTime(at);
  return (
    <time
      className={cx("whitespace-nowrap tabular-nums", className)}
      dateTime={isoTime(at)}
      title={label ? `${label} ${exact}` : exact}
    >
      {prefix ? `${prefix} ` : ""}
      {formatAge(at, now)}
      {suffix ? ` ${suffix}` : ""}
    </time>
  );
}

/** A calendar date in the viewer's locale, with the exact time in its `title`. */
export function DateText({ at, className }: { at: number; className?: string }) {
  return (
    <time className={cx("whitespace-nowrap tabular-nums", className)} dateTime={isoTime(at)} title={formatDateTime(at)}>
      {formatDate(at)}
    </time>
  );
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** A link that leaves the site. Opens a new tab and says so to a screen reader. */
export function ExternalLink({
  href,
  children,
  className,
  title
}: {
  href: string;
  children: ComponentChildren;
  className?: string;
  title?: string;
}) {
  return (
    <a className={className ?? LINK} href={href} rel="noopener noreferrer" target="_blank" title={title}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** The address of an item's page. An undisclosed item has no slug, so its id is used. */
export function itemPath(item: { id: string; slug: string | null }): string {
  return `/items/${encodeURIComponent(item.slug ?? item.id)}`;
}

export function ItemTitleLink({ item }: { item: { id: string; slug: string | null; title: string } }) {
  return (
    <Link className={TITLE_LINK} to={itemPath(item)}>
      {item.title}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Chips
// ---------------------------------------------------------------------------

export type ChipTone = "neutral" | "strong" | "you" | "ok" | "bad" | "owner";

const CHIP_BASE = "inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs leading-4";

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: "border-stone-300 text-stone-700 dark:border-stone-600 dark:text-stone-300",
  strong: "border-stone-500 font-medium text-stone-900 dark:border-stone-400 dark:text-stone-100",
  you: "border-amber-600 bg-amber-100 font-semibold text-amber-950 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100",
  ok: "border-emerald-600 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950 dark:text-emerald-300",
  bad: "border-red-600 bg-red-50 text-red-800 dark:border-red-500 dark:bg-red-950 dark:text-red-300",
  owner: "border-dashed border-stone-500 text-stone-700 dark:border-stone-400 dark:text-stone-300"
};

/** A short labelled fact. The label carries the meaning; the tone only reinforces it. */
export function Chip({
  tone = "neutral",
  children,
  title,
  href
}: {
  tone?: ChipTone;
  children: ComponentChildren;
  title?: string;
  /** When set, the chip is a link out to GitHub. */
  href?: string;
}) {
  const className = cx(CHIP_BASE, CHIP_TONES[tone]);
  if (href) {
    return (
      <ExternalLink
        className={cx(className, FOCUS, "rounded-full underline decoration-dotted underline-offset-2 hover:decoration-solid")}
        href={href}
        title={title}
      >
        {children}
      </ExternalLink>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

/** A wrapping row of chips, as a list so a screen reader hears them one by one. */
export function ChipList({ children, className }: { children: ComponentChildren; className?: string }) {
  return <ul className={cx("flex flex-wrap gap-1.5", className)}>{children}</ul>;
}

// ---------------------------------------------------------------------------
// Sections and surfaces
// ---------------------------------------------------------------------------

/** A page section with a small uppercase heading and an optional plain note beside it. */
export function Section({
  title,
  note,
  children,
  level = 2
}: {
  title: string;
  note?: ComponentChildren;
  children: ComponentChildren;
  level?: 2 | 3;
}) {
  const headingClass = "text-xs font-semibold uppercase tracking-wider";
  return (
    <section className="mt-8">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        {level === 2 ? <h2 className={headingClass}>{title}</h2> : <h3 className={headingClass}>{title}</h3>}
        {note ? <p className={cx("text-xs", TEXT_MUTED)}>{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A bordered surface. `accent` gives it the amber border that marks "needs Jackson". */
export function Box({
  children,
  accent = false,
  className
}: {
  children: ComponentChildren;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cx(
        "overflow-hidden rounded-md border bg-white dark:bg-stone-900",
        accent ? "border-amber-600 dark:border-amber-500" : "border-stone-300 dark:border-stone-700",
        className
      )}
    >
      {children}
    </div>
  );
}

/** A list of rows inside a Box. */
export function RowList({ children }: { children: ComponentChildren }) {
  return <ul className={DIVIDE}>{children}</ul>;
}

/**
 * One row: a narrow lead (a chip or a ref), the body, and a trailing age.
 * On a phone the lead takes its own line above the body.
 */
export function Row({
  lead,
  children,
  trail,
  below
}: {
  lead: ComponentChildren;
  children: ComponentChildren;
  trail?: ComponentChildren;
  /** Full-width content under the row, such as an owner-only note. */
  below?: ComponentChildren;
}) {
  return (
    <li>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3.5 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
        <div className="col-span-2 min-w-0 sm:col-span-1">{lead}</div>
        <div className="min-w-0">{children}</div>
        <div className="text-right text-xs">{trail}</div>
      </div>
      {below}
    </li>
  );
}

/** Small secondary text under a row's title. */
export function RowNote({ children }: { children: ComponentChildren }) {
  return <p className={cx("mt-0.5 text-xs", TEXT_MUTED)}>{children}</p>;
}

/** A plain sentence standing in for a list that has nothing in it. */
export function EmptyNote({ children }: { children: ComponentChildren }) {
  return <p className={cx("px-3.5 py-3", TEXT_MUTED)}>{children}</p>;
}

/** Content only the owner is sent. Marked in words and with a dashed edge, so it is never mistaken for public data. */
export function OwnerOnly({ children, className }: { children: ComponentChildren; className?: string }) {
  return (
    <div
      className={cx(
        "border-t border-dashed border-stone-400 bg-stone-100 px-3.5 py-2 text-[0.8125rem] dark:border-stone-600 dark:bg-stone-800",
        className
      )}
    >
      <p className={cx("mb-0.5 text-[0.6875rem] font-semibold uppercase tracking-wider", TEXT_MUTED)}>Owner only</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading and error states
// ---------------------------------------------------------------------------

const BAR = "rounded bg-stone-200 motion-safe:animate-pulse dark:bg-stone-800";

/** A quiet placeholder while a query loads. It never says "no items". */
export function Skeleton({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  const widths = ["w-11/12", "w-9/12", "w-10/12", "w-7/12", "w-8/12", "w-6/12"] as const;
  return (
    <div aria-busy="true" className="mt-8" role="status">
      <span className="sr-only">{label}</span>
      <div className={cx(BAR, "h-3 w-28")} />
      <div className="mt-3 space-y-3 rounded-md border border-stone-200 p-3.5 dark:border-stone-800">
        {Array.from({ length: rows }, (_, index) => (
          <div className={cx(BAR, "h-4", widths[index % widths.length])} key={index} />
        ))}
      </div>
    </div>
  );
}

/** Shown when a query throws. Says what happened in plain words and offers a retry. */
export function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <div className={cx("mt-8 rounded-md p-4", SURFACE)} role="alert">
      <h2 className="font-semibold">This page could not be loaded</h2>
      <p className={cx("mt-1", TEXT_MUTED)}>
        The request for this page's data failed. The data itself is unaffected.
      </p>
      <p className={cx("mt-2 break-words", MONO, TEXT_MUTED)}>{error.message}</p>
      <button className={cx(BUTTON, "mt-3")} onClick={retry} type="button">
        Try again
      </button>
    </div>
  );
}

/**
 * Renders nothing when a child's query fails. For an optional detail inside a
 * row, where a failure should cost that detail and not the page. Unlike
 * Lakebed's ErrorBoundary it adds no wrapper element, so it can sit inside a list.
 */
export class SilentBoundary extends Component<{ children: ComponentChildren }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export const BUTTON = cx(
  FOCUS,
  "rounded border border-stone-400 px-2.5 py-1 text-[0.8125rem] font-medium hover:bg-stone-100 dark:border-stone-500 dark:hover:bg-stone-800"
);
