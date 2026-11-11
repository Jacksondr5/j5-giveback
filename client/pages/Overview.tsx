// Overview: what needs Jackson, what is on our side, and where everything stands.
//
// Wide, it is columns: the attention queue first, the pipeline and the offered
// table beside it, and the quieter lists after. On a phone they stack in that order.

import { Link } from "lakebed/client";
import type { ComponentChildren } from "preact";
import type { OverviewView, OwnerOverviewView, SyncView } from "../../shared/api";
import { AskTag, FollowUp, OutcomeTag, SideKey, StageTag, ThreadSignals, ThreadToken, UpstreamChanged, Waiting } from "../components/marks";
import { Icon } from "../components/icons";
import { Rail } from "../components/Rail";
import {
  Age,
  CARD,
  DIVIDE,
  DateText,
  EmptyNote,
  FOCUS,
  ItemTitleLink,
  LINK,
  PRIVATE_BLOCK,
  PRIVATE_TIP,
  PrivateBlock,
  SERIF,
  Section,
  Skeleton,
  TEXT_DIM,
  cx,
  useNowValue
} from "../components/ui";
import { client, useTitle, useViewer } from "../data";
import {
  asksOldestFirst,
  candidates,
  closedTime,
  dependencyLinks,
  heldItems,
  medianTimeToMerge,
  offeredQuietestFirst,
  openAsksByItem,
  ourMove,
  quietState,
  recentlyClosed,
  syncStatus,
  type ListAsk,
  type ListItem,
  type Move
} from "../lib/derive";
import { itemsHref } from "../lib/filters";
import { WEEK, formatAge, formatAgo, formatDateTime, formatSpan, plural } from "../lib/format";
import { askAction, listThreads, stageWaitsOnJackson } from "../lib/present";

const OFFERED_SHOWN = 12;
const CLOSED_SHOWN = 8;

const LIST = cx(CARD, DIVIDE, "overflow-hidden");
const META = "mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5";

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

function SyncLine({ sync, owner }: { sync: SyncView; owner: boolean }) {
  const now = useNowValue();
  const status = syncStatus(sync, now);
  const agent =
    sync.lastAgentPushAt === null ? (
      "no agent update yet"
    ) : (
      <span title={formatDateTime(sync.lastAgentPushAt)}>agent update {formatAgo(sync.lastAgentPushAt, now)}</span>
    );

  let github: ComponentChildren;
  if (status.kind === "ok") {
    github = <span title={formatDateTime(status.lastOkAt)}>GitHub synced {formatAgo(status.lastOkAt, now)}</span>;
  } else if (status.kind === "never") {
    github = <strong className="font-semibold text-(color:--ink)">GitHub has not been synced yet: upstream state is missing.</strong>;
  } else if (status.kind === "stale") {
    github = (
      <strong className="font-semibold text-(color:--ink)" title={formatDateTime(status.lastOkAt)}>
        GitHub state is out of date: last synced {formatAgo(status.lastOkAt, now)}.
      </strong>
    );
  } else {
    github = (
      <strong className="font-semibold text-(color:--ink)">
        The last GitHub sync failed{status.failedAt !== null ? ` ${formatAgo(status.failedAt, now)}` : ""}.{" "}
        {status.lastOkAt !== null ? (
          <span title={formatDateTime(status.lastOkAt)}>Upstream state is from {formatAgo(status.lastOkAt, now)}.</span>
        ) : (
          "No sync has succeeded yet: upstream state is missing."
        )}
      </strong>
    );
  }

  return (
    <div className={cx("text-xs", TEXT_DIM)}>
      <p className="flex flex-wrap items-center gap-x-1.5 lg:justify-end">
        <Icon className={status.kind === "ok" ? undefined : "text-(color:--ink)"} name={status.kind === "ok" ? "sync" : "alert"} size={12} />
        <span>
          {github}
          {status.kind === "ok" ? ", " : " "}
          {agent}
        </span>
      </p>
      {owner && status.kind === "failed" ? (
        <PrivateBlock className="mt-1.5 text-(color:--ink)">
          <p className="break-words">Sync error: {status.error}</p>
        </PrivateBlock>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Needs Jackson
// ---------------------------------------------------------------------------

/** Owner only: the agent's recommendation, clipped to a line until opened, and where the draft is. */
function AskAdvice({ recommendation, draftPointer }: { recommendation: string | null; draftPointer: string | null }) {
  if (!recommendation && !draftPointer) return null;
  return (
    <details className={cx(PRIVATE_BLOCK, "group mt-1.5 max-w-[46rem] text-sm leading-5")} title={PRIVATE_TIP}>
      <summary className={cx(FOCUS, "flex cursor-pointer list-none items-start gap-1 rounded-sm [&::-webkit-details-marker]:hidden")}>
        <Icon className={cx("mt-0.5 transition-transform group-open:rotate-90 motion-reduce:transition-none", TEXT_DIM)} name="chevronRight" />
        <span className="min-w-0 truncate group-open:whitespace-pre-wrap group-open:break-words">
          <span className="sr-only">Only you see this: </span>
          {recommendation ? `Recommendation: ${recommendation}` : `Draft: ${draftPointer}`}
        </span>
      </summary>
      {recommendation && draftPointer ? <p className="break-words pl-5">Draft: {draftPointer}</p> : null}
    </details>
  );
}

function AskRow({ ask, index, item }: { ask: ListAsk; index: number; item: ListItem | undefined }) {
  const now = useNowValue();
  const old = now - ask.openedAt >= WEEK;
  const { action, detail } = askAction(ask.kind, ask.label);
  const thread = item ? listThreads(item)[0] : undefined;
  // A route decision is the Deciding stage and a text approval is Approving: the action already says so.
  const stageImplied = stageWaitsOnJackson(ask.item.stage);
  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 px-3 py-2.5 sm:grid-cols-[1rem_3.5rem_minmax(0,1fr)]">
      <span aria-hidden="true" className={cx("hidden pt-1 text-right text-xs tabular-nums sm:block", TEXT_DIM)}>
        {index + 1}
      </span>
      <div>
        <Age
          at={ask.openedAt}
          className={cx(
            SERIF,
            "block rounded px-1 text-center text-base font-bold leading-6",
            old ? "bg-(--you-solid) text-[#2b1d00]" : "bg-(--you-bg) text-(color:--you-ink)"
          )}
          label="Asked"
        />
      </div>
      <div className="min-w-0">
        <p className="max-w-[46rem] text-[0.9375rem] font-bold leading-snug">{action}</p>
        <p>
          <ItemTitleLink item={ask.item} notPublic={item?.isPublic === false} />
        </p>
        {detail ? <p className={cx("max-w-[46rem] text-sm", TEXT_DIM)}>{detail}</p> : null}
        {stageImplied && !thread ? null : (
          <div className={META}>
            {stageImplied ? null : <StageTag stage={ask.item.stage} />}
            {thread ? <ThreadToken link={thread} /> : null}
          </div>
        )}
        <AskAdvice draftPointer={ask.private?.draftPointer ?? null} recommendation={ask.private?.recommendation ?? null} />
      </div>
    </li>
  );
}

function NeedsJackson({ asks, items }: { asks: ListAsk[]; items: ListItem[] }) {
  const now = useNowValue();
  const sorted = asksOldestFirst(asks);
  const oldest = sorted[0];
  const byId = new Map(items.map((item) => [item.id, item]));
  return (
    <Section
      aside={oldest ? <span className={TEXT_DIM}>oldest {formatAge(oldest.openedAt, now)}</span> : undefined}
      count={sorted.length}
      title="Needs Jackson"
    >
      {sorted.length === 0 ? (
        <EmptyNote>Nothing is waiting on Jackson.</EmptyNote>
      ) : (
        <ol className={cx(LIST, "border-l-4 border-l-(color:--you-solid)")}>
          {sorted.map((ask, index) => (
            <AskRow ask={ask} index={index} item={byId.get(ask.item.id)} key={ask.id} />
          ))}
        </ol>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Rows shared by the quieter lists
// ---------------------------------------------------------------------------

function Entry({ item, trail, children }: { item: ListItem; trail: ComponentChildren; children?: ComponentChildren }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-3.5 py-2">
      <div className="min-w-0">
        <p>
          <ItemTitleLink item={item} notPublic={item.isPublic === false} />
        </p>
        {children}
      </div>
      <div className="pt-0.5 text-right text-sm">{trail}</div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Our move
// ---------------------------------------------------------------------------

function MoveRow({ move }: { move: Move }) {
  const { item, reason } = move;
  return (
    <Entry
      item={item}
      trail={
        reason === "upstream_changed" ? (
          <Age at={move.since} label="Changed" prefix="changed" suffix="ago" />
        ) : (
          <Age at={move.since} label="Waiting since" prefix="waiting" />
        )
      }
    >
      <div className={META}>
        <StageTag stage={item.stage} />
        {reason === "upstream_changed" ? (
          <>
            <UpstreamChanged note={null} />
            {item.upstreamChangeNote ? <span className="text-sm">{item.upstreamChangeNote}</span> : null}
          </>
        ) : null}
      </div>
    </Entry>
  );
}

/** Shown only when the next step is on the J5 side: upstream changed under an item, or the agent has it. */
function OurMove({ items }: { items: ListItem[] }) {
  const moves = ourMove(items);
  if (moves.length === 0) return null;
  return (
    <Section count={moves.length} title="Our move">
      <ul className={LIST} title="Upstream changed under the item, or the giveback agent has the next step">
        {moves.map((move) => (
          <MoveRow key={move.item.id} move={move} />
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pipeline and figures
// ---------------------------------------------------------------------------

function Figure({ value, label, title, to }: { value: string; label: string; title?: string; to?: string }) {
  const body = (
    <>
      <span className={cx(SERIF, "text-2xl font-bold leading-7 tabular-nums")}>{value}</span>
      <span className="text-sm">{label}</span>
    </>
  );
  const frame = "flex items-baseline gap-x-2 rounded-sm";
  return to ? (
    <Link className={cx(frame, FOCUS, "hover:underline hover:underline-offset-2")} title={title} to={to}>
      {body}
    </Link>
  ) : (
    <p className={frame} title={title}>
      {body}
    </p>
  );
}

function Pipeline({ overview, items }: { overview: OverviewView; items: ListItem[] }) {
  const { stats, pipeline } = overview;
  const merge = medianTimeToMerge(items);
  return (
    <section aria-label="Pipeline" className={cx(CARD, "px-2 pb-3 pt-3 sm:px-3")}>
      <Rail
        label="Items at each stage"
        stops={pipeline.map(({ stage, count }) => ({ stage, count, href: itemsHref({ stage }) }))}
      />
      <div className="mt-3 flex flex-wrap gap-x-8 gap-y-1 border-t border-(color:--rule) px-1 pt-2.5 sm:px-2">
        <Figure
          label={`merged, of ${stats.closed} closed`}
          to={itemsHref({ outcome: "merged" })}
          value={String(stats.merged)}
        />
        <Figure
          label="median, PR opened to merged"
          title={merge.count > 0 ? `Over ${plural(merge.count, "merged item", "merged items")}` : "No merged items yet"}
          value={merge.medianMs === null ? "–" : formatSpan(merge.medianMs)}
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Offered upstream
// ---------------------------------------------------------------------------

// Three columns when the list itself is wide enough, whatever the screen: it is
// a container query, so a narrow column stacks the row instead.
const OFFERED_GRID = "@2xl:grid @2xl:grid-cols-[minmax(0,1fr)_9.5rem_6rem] @2xl:gap-x-4";

function OfferedRow({ item, asks }: { item: ListItem; asks: ListAsk[] }) {
  const link = item.primaryLink;
  const quiet = quietState(item);
  const dependencies = dependencyLinks(item.dependencyLinks).filter((dependency) => dependency.id !== link?.id);
  // Offered items wait on a maintainer unless something says otherwise, so only the exceptions are spelled out.
  const waiting = item.waitingOn !== "maintainer" && !(asks.length > 0 && item.waitingOn === "jackson");
  return (
    <li className={cx("grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-3.5 py-2", OFFERED_GRID)}>
      {/* Stacked: title and activity, then the threads, then the checks. Wide: item and threads, checks, activity. */}
      <div className="order-1 min-w-0 @2xl:order-none">
        <p>
          <ItemTitleLink item={item} notPublic={item.isPublic === false} />
        </p>
      </div>
      <div className="order-3 col-span-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 @2xl:order-none @2xl:col-span-1 @2xl:col-start-1 @2xl:row-start-2">
        {link ? <ThreadToken link={link} /> : item.disclosed ? <span className={cx("text-sm", TEXT_DIM)}>Nothing of ours</span> : null}
        {asks.map((ask) => (
          <AskTag key={ask.id}>{askAction(ask.kind, ask.label).action}</AskTag>
        ))}
        {waiting ? <Waiting waitingOn={item.waitingOn} /> : null}
        {item.upstreamChangedAt !== null ? <UpstreamChanged note={item.upstreamChangeNote} /> : null}
        {dependencies.map((dependency) => (
          <ThreadToken key={dependency.id} link={dependency} role />
        ))}
      </div>
      <div className="order-4 col-span-2 min-w-0 empty:hidden @2xl:order-none @2xl:col-span-1 @2xl:col-start-2 @2xl:row-span-2 @2xl:row-start-1 @2xl:pt-0.5 @2xl:empty:block">
        {link ? <ThreadSignals link={link} /> : null}
      </div>
      <div className="order-2 pt-0.5 text-right text-sm @2xl:order-none @2xl:col-start-3 @2xl:row-span-2 @2xl:row-start-1">
        <Age
          at={quiet.since}
          // Neutral wording on purpose: upstream owes no reply, so this states when
          // the thread last moved and never counts or stresses anyone's silence.
          label={
            quiet.replied
              ? `Last upstream activity, by ${quiet.by ?? "someone else"}`
              : quiet.synced
                ? "No upstream activity yet. Waiting since"
                : "Upstream activity has not been read yet. Waiting since"
          }
          prefix={quiet.replied ? "active" : "waiting"}
          suffix={quiet.replied ? "ago" : undefined}
        />
      </div>
    </li>
  );
}

function Offered({ items, asks }: { items: ListItem[]; asks: ListAsk[] }) {
  const offered = offeredQuietestFirst(items);
  const asksByItem = openAsksByItem(asks);
  const shown = offered.slice(0, OFFERED_SHOWN);
  return (
    <Section
      aside={
        offered.length > shown.length ? (
          <Link className={LINK} to={itemsHref({ stage: "offered" })}>
            All {offered.length}
          </Link>
        ) : undefined
      }
      count={offered.length}
      title="Offered upstream"
    >
      {offered.length === 0 ? (
        <EmptyNote>Nothing is offered upstream right now.</EmptyNote>
      ) : (
        <div className={cx(CARD, "@container overflow-hidden")}>
          <div aria-hidden="true" className={cx("hidden border-b border-(color:--rule) px-3.5 py-1.5 text-xs", OFFERED_GRID, TEXT_DIM)}>
            <span className="flex flex-wrap gap-x-3">
              Item and thread <SideKey />
            </span>
            <span>Checks</span>
            <span
              className="text-right"
              title="The last comment or review by anyone other than Jackson, bots excluded. Least recently active first. Offered items wait on a maintainer unless the row says otherwise."
            >
              Activity
            </span>
          </div>
          <ul className={DIVIDE}>
            {shown.map((item) => (
              <OfferedRow asks={asksByItem.get(item.id) ?? []} item={item} key={item.id} />
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function CandidateRow({ item }: { item: ListItem }) {
  const hot = stageWaitsOnJackson(item.stage) && item.waitingOn === "jackson";
  // A candidate is the agent's to move on unless it is Jackson's; only another wait is worth a word.
  const waiting = !hot && item.waitingOn !== "giveback_agent";
  return (
    <Entry item={item} trail={<Age at={item.foundAt} label="Found" prefix="found" suffix="ago" />}>
      <div className={META}>
        <StageTag hot={hot} stage={item.stage} />
        {waiting ? <Waiting waitingOn={item.waitingOn} /> : null}
        {item.disclosed && item.lastValidatedAt !== null ? (
          <span className={cx("text-sm", TEXT_DIM)}>
            validated <DateText at={item.lastValidatedAt} />
          </span>
        ) : null}
      </div>
    </Entry>
  );
}

function Candidates({ items }: { items: ListItem[] }) {
  const list = candidates(items);
  return (
    <Section count={list.length} title="Candidates">
      {list.length === 0 ? (
        <EmptyNote>No candidates are being checked right now.</EmptyNote>
      ) : (
        <ul className={LIST}>
          {list.map((item) => (
            <CandidateRow item={item} key={item.id} />
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Held
// ---------------------------------------------------------------------------

function HeldRow({ item }: { item: ListItem }) {
  const links = dependencyLinks(item.dependencyLinks);
  return (
    <Entry item={item} trail={<Age at={item.waitingSince} label="Waiting since" prefix="waiting" />}>
      <div className={META}>
        {item.waitingOn === "jackson" || links.length === 0 ? <Waiting waitingOn={item.waitingOn} /> : null}
        {links.map((link) => (
          <ThreadToken key={link.id} link={link} role />
        ))}
      </div>
    </Entry>
  );
}

/** Shown only when something is held. */
function Held({ items }: { items: ListItem[] }) {
  const list = heldItems(items);
  if (list.length === 0) return null;
  return (
    <Section count={list.length} title="Held">
      <ul className={LIST}>
        {list.map((item) => (
          <HeldRow item={item} key={item.id} />
        ))}
      </ul>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Recently closed
// ---------------------------------------------------------------------------

function ClosedRow({ item }: { item: ListItem }) {
  return (
    <Entry item={item} trail={<Age at={closedTime(item)} label="Closed" suffix="ago" />}>
      <div className={META}>
        {item.outcome ? <OutcomeTag outcome={item.outcome} /> : null}
        {item.primaryLink ? <ThreadToken link={item.primaryLink} /> : null}
        <FollowUp state={item.followUpState} />
      </div>
      {item.followUpNote ? (
        <p className={cx("mt-0.5 truncate text-sm", TEXT_DIM)} title={item.followUpNote}>
          {item.followUpNote}
        </p>
      ) : null}
    </Entry>
  );
}

function RecentlyClosed({ items, total }: { items: ListItem[]; total: number }) {
  const list = recentlyClosed(items, CLOSED_SHOWN);
  return (
    <Section
      aside={
        total > list.length ? (
          <Link className={LINK} to={itemsHref({ stage: "closed" })}>
            All {total}
          </Link>
        ) : undefined
      }
      count={total}
      title="Recently closed"
    >
      {list.length === 0 ? (
        <EmptyNote>Nothing has closed yet.</EmptyNote>
      ) : (
        <ul className={LIST}>
          {list.map((item) => (
            <ClosedRow item={item} key={item.id} />
          ))}
        </ul>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function Intro({ children }: { children?: ComponentChildren }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-1 py-3">
      <h1 className="sr-only">Overview</h1>
      <p className={cx("text-sm", TEXT_DIM)}>
        Bug fixes found while maintaining J5 Code, a fork of T3 Code, and offered back upstream.
      </p>
      {children}
    </div>
  );
}

function OverviewBody({
  overview,
  items,
  owner
}: {
  overview: OverviewView | OwnerOverviewView | undefined;
  items: ListItem[] | undefined;
  owner: boolean;
}) {
  if (overview === undefined || items === undefined) {
    return <OverviewSkeleton />;
  }
  if (overview.stats.total === 0) {
    return (
      <>
        {/* With nothing recorded there is no upstream state to be stale, so only a run that happened is reported. */}
        <Intro>{overview.sync.lastGithubSyncAt !== null ? <SyncLine owner={owner} sync={overview.sync} /> : null}</Intro>
        <div className={cx(CARD, "max-w-2xl px-3.5 py-4")}>
          <h2 className={cx(SERIF, "text-lg font-bold")}>No items have been recorded yet</h2>
          <p className={cx("mt-1", TEXT_DIM)}>
            Items appear here when a J5 agent records a candidate fix.{" "}
            <Link className={LINK} to="/about">
              How it works
            </Link>
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <Intro>
        <SyncLine owner={owner} sync={overview.sync} />
      </Intro>
      {/*
        One column on a phone: the queue, the pipeline and the offered list, then
        our move and the quieter lists. From lg: the queue, our move and the quieter
        lists on the left, the pipeline and the offered table on the right. From
        1800 px: three columns, with the quieter lists in the third. The two outer
        wrappers are columns only between lg and 1800 px; elsewhere their children sit in the grid directly.
      */}
      <div className="grid grid-cols-1 gap-x-8 gap-y-7 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] min-[112.5rem]:grid-cols-[minmax(0,5fr)_minmax(0,8fr)_minmax(0,5fr)] min-[112.5rem]:grid-rows-[auto_1fr]">
        <div className="contents lg:block lg:space-y-7 min-[112.5rem]:contents">
          <div className="contents lg:block lg:space-y-7 min-[112.5rem]:col-start-1 min-[112.5rem]:row-span-2 min-[112.5rem]:row-start-1">
            <div className="order-1">
              <NeedsJackson asks={overview.openAsks} items={items} />
            </div>
            <div className="order-3 empty:hidden">
              <OurMove items={items} />
            </div>
          </div>
          <div className="order-4 space-y-7 min-[112.5rem]:col-start-3 min-[112.5rem]:row-start-1">
            <Candidates items={items} />
            <Held items={items} />
          </div>
        </div>
        <div className="contents lg:block lg:space-y-7 min-[112.5rem]:contents">
          <div className="order-2 space-y-7 min-[112.5rem]:col-start-2 min-[112.5rem]:row-span-2 min-[112.5rem]:row-start-1">
            <Pipeline items={items} overview={overview} />
            <Offered asks={overview.openAsks} items={items} />
          </div>
          <div className="order-5 min-[112.5rem]:col-start-3 min-[112.5rem]:row-start-2">
            <RecentlyClosed items={items} total={overview.stats.closed} />
          </div>
        </div>
      </div>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-x-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
      <Skeleton label="Loading the overview" rows={5} />
      <Skeleton label="Loading the overview" rows={5} />
    </div>
  );
}

function PublicOverview() {
  return <OverviewBody items={client.useQuery("items")} overview={client.useQuery("overview")} owner={false} />;
}

function OwnerOverview() {
  return <OverviewBody items={client.useQuery("ownerItems")} overview={client.useQuery("ownerOverview")} owner />;
}

export function OverviewPage() {
  useTitle(null);
  const viewer = useViewer();
  if (viewer === undefined) return <OverviewSkeleton />;
  return viewer.isOwner ? <OwnerOverview /> : <PublicOverview />;
}
