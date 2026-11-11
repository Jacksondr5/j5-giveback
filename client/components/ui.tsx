// Shared building blocks: colour and type tokens, links, ages, sections and the
// loading, empty and error states.
//
// Every Tailwind class here is written out in full. Enumerations map to complete
// class strings; nothing builds a class name from a variable.

import { Link } from "lakebed/client";
import { Component, createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { formatItemId, itemIdOf } from "../../shared/itemId";
import { formatAge, formatDate, formatDateTime, isoTime } from "../lib/format";
import { itemPath, type Tone } from "../lib/present";
import { Icon } from "./icons";

/** Joins class strings, skipping the empty ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" ");
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

// The palette, as custom properties on the root element. Light values first,
// then the dark ones, which follow the system setting.
//
//   paper, card     the page and the surfaces on it: a cool grey and white
//   ink, dim        text
//   rule, edge      hairlines and stronger borders
//   you-*           amber, for what waits on Jackson and nothing else
//   open, merged, closed, draft, pending
//                   GitHub's own state colours, used only on a state icon and its words
//   serif, sans     Charter for titles and figures, the system sans for everything else
//   mono            the system monospace, for an item's ID and nothing else
export const ROOT_TOKENS = [
  "[--paper:#f1f3f6]",
  "[--card:#ffffff]",
  "[--ink:#17202b]",
  "[--dim:#4c5665]",
  "[--rule:#d5dbe2]",
  "[--edge:#8d98a5]",
  "[--you-bg:#ffedb8]",
  "[--you-ink:#402b00]",
  "[--you-edge:#b97f00]",
  "[--you-solid:#f5b301]",
  "[--open:#1a7f37]",
  "[--merged:#7a48d6]",
  "[--closed:#c7202b]",
  "[--draft:#59636e]",
  "[--pending:#8a5d00]",
  "dark:[--paper:#0f151c]",
  "dark:[--card:#17202a]",
  "dark:[--ink:#e7ecf2]",
  "dark:[--dim:#a9b4c1]",
  "dark:[--rule:#2a3542]",
  "dark:[--edge:#5d6b7b]",
  "dark:[--you-bg:#3a2b06]",
  "dark:[--you-ink:#ffe199]",
  "dark:[--you-edge:#d9a017]",
  "dark:[--you-solid:#f5b301]",
  "dark:[--open:#3fb950]",
  "dark:[--merged:#b08bf9]",
  "dark:[--closed:#ff6b63]",
  "dark:[--draft:#9198a1]",
  "dark:[--pending:#d9a017]",
  "[--serif:Charter,'Bitstream_Charter','Sitka_Text',Cambria,'DejaVu_Serif',Georgia,serif]",
  "[--sans:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe_UI',Roboto,'Liberation_Sans',Arial,sans-serif]",
  "[--mono:ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation_Mono','DejaVu_Sans_Mono',monospace]",
  "bg-(--paper)",
  "scheme-light",
  "dark:scheme-dark"
] as const;

export const SERIF = "[font-family:var(--serif)]";
export const SANS = "[font-family:var(--sans)]";
export const TEXT_DIM = "text-(color:--dim)";
export const CARD = "rounded-md border border-(color:--rule) bg-(--card)";
export const DIVIDE = "divide-y divide-(color:--rule)";
export const FOCUS = "outline-offset-2 outline-(color:--ink) focus-visible:outline-2";
export const LINK = cx(
  FOCUS,
  "rounded-sm underline decoration-(color:--edge) underline-offset-2 hover:decoration-(color:--ink)"
);
/** A title that is a link: the serif face, and no underline until hover, so a list of them stays calm. */
export const TITLE_LINK = cx(FOCUS, SERIF, "rounded-sm text-[0.9375rem] leading-snug hover:underline hover:underline-offset-2");
/** Upstream refs, SHAs and branch names: the sans face with even digits. */
export const REF = "tabular-nums";
/**
 * An item's own ID, "GB-12": small, monospaced and dim, so it reads as a handle
 * and never competes with the title it sits in front of. Upright even where the
 * title is italic. It is the one thing on the site set in the monospace face.
 */
export const ITEM_ID = "[font-family:var(--mono)] font-normal not-italic tabular-nums text-(color:--dim)";

export const TONE_TEXT: Record<Tone, string> = {
  open: "text-(color:--open)",
  merged: "text-(color:--merged)",
  closed: "text-(color:--closed)",
  draft: "text-(color:--draft)",
  pending: "text-(color:--pending)",
  dim: "text-(color:--dim)"
};

// The one mark for content only the owner is sent: a dashed edge or a dashed
// underline. Nothing else on the site is dashed.
export const PRIVATE_TIP = "Dashed: only you see this";
export const PRIVATE_BLOCK = "border-l-2 border-dashed border-(color:--edge) pl-2.5";
export const PRIVATE_BOX = "rounded-md border border-dashed border-(color:--edge)";
export const PRIVATE_TEXT = "underline decoration-(color:--edge) decoration-dashed decoration-1 underline-offset-4";

// What waits on Jackson.
export const YOU_TAG = "bg-(--you-bg) text-(color:--you-ink)";

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

export const UNDISCLOSED_TIP = "Details are withheld until this candidate is offered upstream.";

/**
 * An item's title, linking to its page. `notPublic` is the owner's view of an
 * item visitors see only as an undisclosed candidate: it takes the dashed
 * underline. An undisclosed item, as a visitor sees it, is set in italics.
 */
export function ItemTitleLink({
  item,
  notPublic = false,
  className
}: {
  item: { id: string; slug: string | null; title: string; disclosed?: boolean; number?: number | null };
  notPublic?: boolean;
  className?: string;
}) {
  const undisclosed = item.disclosed === false;
  const id = itemIdOf(item);
  return (
    <Link
      className={cx(TITLE_LINK, notPublic && PRIVATE_TEXT, undisclosed && cx("italic", TEXT_DIM), className)}
      title={notPublic ? `Not public. ${PRIVATE_TIP}.` : undisclosed ? UNDISCLOSED_TIP : undefined}
      to={itemPath(item)}
    >
      {/*
        The ID leads the title in every list, in a box of one width, so titles
        start in line down a list and a long title wraps under its ID at full
        width. An inline block takes no underline from the link around it.
        An item with no number yet has no box: its title starts at the edge.
      */}
      {id ? <span className={cx(ITEM_ID, "mr-1 inline-block min-w-[2.75rem] text-xs")}>{id}</span> : null}
      {item.title}
      {notPublic ? <span className="sr-only"> (not public)</span> : null}
    </Link>
  );
}

/**
 * An item's ID as a control that copies it: for the item page, where the ID is
 * picked up to be said or pasted to an agent. It looks like the ID in a list,
 * with a small copy mark. Where the clipboard is not available it selects the
 * ID instead, so the usual copy shortcut works.
 */
export function CopyItemId({ number, className }: { number: number; className?: string }) {
  const id = formatItemId(number);
  const [copied, setCopied] = useState(false);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      const node = text.current;
      const selection = window.getSelection();
      if (!node || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  return (
    <>
      <button
        className={cx(
          FOCUS,
          ITEM_ID,
          "inline-flex cursor-pointer select-text items-baseline gap-1 rounded-sm hover:text-(color:--ink)",
          className
        )}
        onClick={copy}
        title={`Copy ${id}`}
        type="button"
      >
        <span ref={text}>{id}</span>
        <Icon className="self-center" name={copied ? "check" : "copy"} size={12} />
      </button>
      <span className="sr-only" role="status">
        {copied ? `Copied ${id}` : ""}
      </span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/** A page section: a serif heading, its count, and an optional link at the far end. */
export function Section({
  title,
  count,
  aside,
  children,
  className
}: {
  title: string;
  count?: number;
  aside?: ComponentChildren;
  children: ComponentChildren;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-baseline gap-x-2">
        <h2 className={cx(SERIF, "text-lg font-bold leading-6")}>{title}</h2>
        {count !== undefined ? <span className={cx("text-sm tabular-nums", TEXT_DIM)}>{count}</span> : null}
        {aside ? <div className="ml-auto text-sm">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** A plain sentence standing in for a list that has nothing in it. */
export function EmptyNote({ children }: { children: ComponentChildren }) {
  return <p className={cx(CARD, "px-3.5 py-3", TEXT_DIM)}>{children}</p>;
}

/** Text only the owner is sent, set off by the dashed edge. */
export function PrivateBlock({ children, className }: { children: ComponentChildren; className?: string }) {
  return (
    <div className={cx(PRIVATE_BLOCK, "text-sm leading-5", className)} title={PRIVATE_TIP}>
      <span className="sr-only">Only you see this: </span>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading and error states
// ---------------------------------------------------------------------------

const BAR = "rounded bg-(--rule) motion-safe:animate-pulse";

/** A quiet placeholder while a query loads. It never says "no items". */
export function Skeleton({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  const widths = ["w-11/12", "w-9/12", "w-10/12", "w-7/12", "w-8/12", "w-6/12"] as const;
  return (
    <div aria-busy="true" className="mt-6" role="status">
      <span className="sr-only">{label}</span>
      <div className={cx(BAR, "h-4 w-36")} />
      <div className={cx(CARD, "mt-3 space-y-3 p-3.5")}>
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
    <div className={cx(CARD, "mt-6 max-w-2xl p-4")} role="alert">
      <h2 className={cx(SERIF, "text-lg font-bold")}>This page could not be loaded</h2>
      <p className={cx("mt-1", TEXT_DIM)}>The request for this page's data failed. The data itself is unaffected.</p>
      <p className={cx("mt-2 break-words text-xs", TEXT_DIM)}>{error.message}</p>
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
  "cursor-pointer rounded border border-(color:--edge) px-2.5 py-1 text-sm font-medium hover:bg-(--paper)"
);
