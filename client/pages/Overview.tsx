// Overview: what needs Jackson, what is on our side, and where everything stands.

import { Link } from "lakebed/client";
import type { ComponentChildren } from "preact";
import type { LinkView, OverviewView, OwnerOverviewView, SyncView } from "../../shared/api";
import { ASK_KIND_LABELS, STAGE_LABELS, type Stage } from "../../shared/enums";
import {
  CiChip,
  DependencyChip,
  FollowUpChip,
  LinkStateChip,
  MacroscopeChip,
  NotPublicChip,
  OutcomeChip,
  ReviewChip,
  StageChip,
  TriageChip,
  UpstreamChangedChip,
  WaitingChip,
  stageWaitsOnJackson,
  waitingPhrase
} from "../components/chips";
import { RefLead } from "../components/refs";
import {
  Age,
  Box,
  Chip,
  ChipList,
  DateText,
  EmptyNote,
  FOCUS,
  ItemTitleLink,
  LINK,
  OwnerOnly,
  Row,
  RowList,
  RowNote,
  Section,
  SilentBoundary,
  Skeleton,
  TEXT_MUTED,
  cx,
  useNowValue
} from "../components/ui";
import { client, useTitle, useViewer } from "../data";
import {
  asksOldestFirst,
  candidates,
  closedTime,
  dependencyLinks,
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

const OFFERED_SHOWN = 8;
const CLOSED_SHOWN = 8;

const UNDISCLOSED_NOTE = "Details are withheld until this candidate is offered upstream.";

// ---------------------------------------------------------------------------
// Sync line
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
    github = <span title={formatDateTime(status.lastOkAt)}>GitHub state synced {formatAgo(status.lastOkAt, now)}</span>;
  } else if (status.kind === "never") {
    github = (
      <strong className="font-semibold text-stone-900 dark:text-stone-100">
        GitHub state has not been synced yet, so upstream status is missing below.
      </strong>
    );
  } else if (status.kind === "stale") {
    github = (
      <strong className="font-semibold text-stone-900 dark:text-stone-100" title={formatDateTime(status.lastOkAt)}>
        GitHub state is out of date: last synced {formatAgo(status.lastOkAt, now)}.
      </strong>
    );
  } else {
    github = (
      <strong className="font-semibold text-stone-900 dark:text-stone-100">
        The last GitHub sync failed{status.failedAt !== null ? ` ${formatAgo(status.failedAt, now)}` : ""}.{" "}
        {status.lastOkAt !== null ? (
          <span title={formatDateTime(status.lastOkAt)}>
            Upstream status below is from the last good sync, {formatAgo(status.lastOkAt, now)}.
          </span>
        ) : (
          "No sync has succeeded yet, so upstream status is missing below."
        )}
      </strong>
    );
  }

  return (
    <div className="mt-3">
      <p className={cx("text-xs", TEXT_MUTED)}>
        {github}
        {status.kind === "ok" ? " · " : " "}
        {agent}
      </p>
      {owner && status.kind === "failed" ? (
        <OwnerOnly className="mt-2 rounded-md border border-dashed">
          <p className="break-words">Sync error: {status.error}</p>
        </OwnerOnly>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tiles
// ---------------------------------------------------------------------------

function Tile({ value, label, sub, to }: { value: string; label: string; sub?: string; to?: string }) {
  const body = (
    <>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs">{label}</p>
      {sub ? <p className={cx("text-xs", TEXT_MUTED)}>{sub}</p> : null}
    </>
  );
  const frame = "block h-full rounded-md border border-stone-300 bg-white px-3.5 py-3 dark:border-stone-700 dark:bg-stone-900";
  return (
    <li>
      {to ? (
        <Link className={cx(frame, FOCUS, "hover:border-stone-500 dark:hover:border-stone-400")} to={to}>
          {body}
        </Link>
      ) : (
        <div className={frame}>{body}</div>
      )}
    </li>
  );
}

function Tiles({ overview, items }: { overview: OverviewView; items: ListItem[] }) {
  const { stats, pipeline } = overview;
  const deciding = pipeline.find((entry) => entry.stage === "deciding")?.count ?? 0;
  const merge = medianTimeToMerge(items);
  return (
    <ul className="mt-5 grid grid-cols-2 gap-2.5 md:grid-cols-4">
      <Tile
        label="merged upstream"
        sub={`of ${stats.closed} closed`}
        to={itemsHref({ outcome: "merged" })}
        value={String(stats.merged)}
      />
      <Tile
        label="open upstream"
        sub="offered, not yet closed"
        to={itemsHref({ stage: "offered" })}
        value={String(stats.offered)}
      />
      <Tile
        label="awaiting a decision"
        sub="validated, route not chosen"
        to={itemsHref({ stage: "deciding" })}
        value={String(deciding)}
      />
      <Tile
        label="median, PR opened to merged"
        sub={merge.count > 0 ? `over ${plural(merge.count, "merged item", "merged items")}` : "no merged items yet"}
        value={merge.medianMs === null ? "–" : formatSpan(merge.medianMs)}
      />
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Needs Jackson
// ---------------------------------------------------------------------------

function AskRow({ ask, notPublic }: { ask: ListAsk; notPublic: boolean }) {
  const now = useNowValue();
  const old = now - ask.openedAt >= WEEK;
  const recommendation = ask.private?.recommendation ?? null;
  const draftPointer = ask.private?.draftPointer ?? null;
  return (
    <Row
      below={
        recommendation || draftPointer ? (
          <OwnerOnly className="sm:pl-[11.625rem]">
            {recommendation ? <p className="whitespace-pre-wrap break-words">Recommendation: {recommendation}</p> : null}
            {draftPointer ? <p className="break-words">Draft: {draftPointer}</p> : null}
          </OwnerOnly>
        ) : null
      }
      lead={
        <ChipList>
          <li>
            <Chip tone="you">{ASK_KIND_LABELS[ask.kind]}</Chip>
          </li>
        </ChipList>
      }
      trail={<Age at={ask.openedAt} className={old ? "font-semibold" : undefined} label="Asked" />}
    >
      <p>
        <ItemTitleLink item={ask.item} />
        {notPublic ? (
          <>
            {" "}
            <NotPublicChip />
          </>
        ) : null}
      </p>
      <RowNote>
        {STAGE_LABELS[ask.item.stage]} · {ask.label ?? UNDISCLOSED_NOTE}
      </RowNote>
    </Row>
  );
}

function NeedsJackson({ asks, items }: { asks: ListAsk[]; items: ListItem[] }) {
  // Only the owner's list says which items are not public; for everyone else this set is empty.
  const notPublic = new Set(items.filter((item) => item.isPublic === false).map((item) => item.id));
  const now = useNowValue();
  const sorted = asksOldestFirst(asks);
  const oldest = sorted[0];
  return (
    <Section
      note={
        oldest ? `${plural(sorted.length, "open ask", "open asks")} · oldest ${formatAge(oldest.openedAt, now)}` : undefined
      }
      title="Needs Jackson"
    >
      {sorted.length === 0 ? (
        <Box>
          <EmptyNote>Nothing is waiting on Jackson.</EmptyNote>
        </Box>
      ) : (
        <Box accent>
          <RowList>
            {sorted.map((ask) => (
              <AskRow ask={ask} key={ask.id} notPublic={notPublic.has(ask.item.id)} />
            ))}
          </RowList>
        </Box>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Our move
// ---------------------------------------------------------------------------

function MoveRow({ move }: { move: Move }) {
  const { item, reason } = move;
  return (
    <Row
      lead={
        <ChipList>
          <li>{reason === "upstream_changed" ? <UpstreamChangedChip note={null} /> : <StageChip stage={item.stage} />}</li>
        </ChipList>
      }
      trail={<Age at={move.since} label={reason === "upstream_changed" ? "Changed" : "Waiting since"} />}
    >
      <p>
        <ItemTitleLink item={item} />
      </p>
      <RowNote>
        {reason === "upstream_changed"
          ? `${STAGE_LABELS[item.stage]} · ${item.upstreamChangeNote ?? "An upstream thread this item depends on changed state."}`
          : waitingPhrase(item.waitingOn)}
      </RowNote>
    </Row>
  );
}

function OurMove({ items }: { items: ListItem[] }) {
  const moves = ourMove(items);
  if (moves.length === 0) return null;
  return (
    <Section note="upstream changed underneath an item, or the giveback agent has the next step" title="Our move">
      <Box>
        <RowList>
          {moves.map((move) => (
            <MoveRow key={move.item.id} move={move} />
          ))}
        </RowList>
      </Box>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/** Who moves an item on from each stage, as the pipeline defines it. */
const STAGE_MOVER: Record<Stage, string> = {
  found: "agent",
  validating: "agent",
  deciding: "Jackson",
  preparing: "agent",
  approving: "Jackson",
  offered: "upstream",
  closed: "done"
};

function Pipeline({ pipeline }: { pipeline: OverviewView["pipeline"] }) {
  return (
    <Section title="Pipeline">
      <ol className="grid grid-cols-4 gap-1 md:grid-cols-7">
        {pipeline.map(({ stage, count }) => {
          const hot = stageWaitsOnJackson(stage);
          return (
            <li key={stage}>
              <Link
                className={cx(
                  FOCUS,
                  "block h-full rounded-md border px-1.5 py-2.5 text-center",
                  hot
                    ? "border-amber-600 bg-amber-100 text-amber-950 hover:border-amber-800 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100 dark:hover:border-amber-300"
                    : "border-stone-300 bg-white hover:border-stone-500 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-stone-400"
                )}
                to={itemsHref({ stage })}
              >
                <span className="block text-lg font-semibold tabular-nums">{count}</span>
                <span className="block text-xs">{STAGE_LABELS[stage]}</span>
                <span className={cx("block text-[0.6875rem]", hot ? "font-semibold" : TEXT_MUTED)}>
                  <span className="sr-only">{stage === "closed" ? "" : "waits on "}</span>
                  {STAGE_MOVER[stage]}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
      <p className={cx("mt-2 text-xs", TEXT_MUTED)}>
        Under each stage is who moves an item on from it. The two marked Jackson wait on him. Each stage opens the item
        list filtered to it.
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Offered upstream
// ---------------------------------------------------------------------------

function Dependencies({ links }: { links: readonly LinkView[] }) {
  return (
    <>
      {dependencyLinks(links).map((link) => (
        <li key={link.id}>
          <DependencyChip link={link} />
        </li>
      ))}
    </>
  );
}

function OfferedRow({ item, owner, asks }: { item: ListItem; owner: boolean; asks: ListAsk[] }) {
  const link = item.primaryLink;
  const quiet = quietState(item);
  const now = useNowValue();
  const quietLong = now - quiet.since >= WEEK;
  return (
    <Row
      lead={<RefLead link={link} />}
      trail={
        <Age
          at={quiet.since}
          className={quietLong ? "font-semibold" : undefined}
          label={
            quiet.replied
              ? `Last heard from ${quiet.by ?? "someone else"}`
              : quiet.synced
                ? "No reply yet. Waiting since"
                : "Upstream activity has not been read yet. Waiting since"
          }
          suffix={quiet.replied ? "quiet" : quiet.synced ? "no reply" : "waiting"}
        />
      }
    >
      <p>
        <ItemTitleLink item={item} />
      </p>
      <ChipList className="mt-1">
        {item.isPublic === false ? (
          <li>
            <NotPublicChip />
          </li>
        ) : null}
        {asks.map((ask) => (
          <li key={ask.id}>
            <Chip tone="you">Needs Jackson · {ASK_KIND_LABELS[ask.kind]}</Chip>
          </li>
        ))}
        {asks.length > 0 && item.waitingOn === "jackson" ? null : (
          <li>
            <WaitingChip waitingOn={item.waitingOn} />
          </li>
        )}
        {item.upstreamChangedAt !== null ? (
          <li>
            <UpstreamChangedChip note={item.upstreamChangeNote} />
          </li>
        ) : null}
        {link && link.state !== null && (link.state !== "open" || link.isDraft) ? (
          <li>
            <LinkStateChip link={link} />
          </li>
        ) : null}
        {link?.ci ? (
          <li>
            <CiChip ci={link.ci} />
          </li>
        ) : null}
        {link?.reviewDecision ? (
          <li>
            <ReviewChip decision={link.reviewDecision} />
          </li>
        ) : null}
        {link?.macroscopeVerdict ? (
          <li>
            <MacroscopeChip verdict={link.macroscopeVerdict} />
          </li>
        ) : null}
        {link && (link.triageBucket !== null || link.triageRank !== null) ? (
          <li>
            <TriageChip bucket={link.triageBucket} rank={link.triageRank} />
          </li>
        ) : null}
        {item.disclosed ? (
          <SilentBoundary>
            <Dependencies links={item.dependencyLinks} />
          </SilentBoundary>
        ) : null}
      </ChipList>
      {item.disclosed ? null : <RowNote>{UNDISCLOSED_NOTE}</RowNote>}
    </Row>
  );
}

function Offered({ items, owner, asks }: { items: ListItem[]; owner: boolean; asks: ListAsk[] }) {
  const offered = offeredQuietestFirst(items);
  const asksByItem = openAsksByItem(asks);
  const shown = offered.slice(0, OFFERED_SHOWN);
  return (
    <Section
      note={offered.length > 0 ? `${offered.length} open · quietest first` : undefined}
      title="Offered upstream"
    >
      <Box>
        {offered.length === 0 ? (
          <EmptyNote>Nothing is offered upstream right now.</EmptyNote>
        ) : (
          <RowList>
            {shown.map((item) => (
              <OfferedRow asks={asksByItem.get(item.id) ?? []} item={item} key={item.id} owner={owner} />
            ))}
          </RowList>
        )}
      </Box>
      {offered.length > shown.length ? (
        <p className="mt-2 text-xs">
          <Link className={LINK} to={itemsHref({ stage: "offered" })}>
            All {offered.length} offered items
          </Link>
        </p>
      ) : null}
      {offered.length > 0 ? (
        <p className={cx("mt-2 text-xs", TEXT_MUTED)}>
          Quiet counts from the last comment or review by anyone other than Jackson, bots excluded.
        </p>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function CandidateRow({ item }: { item: ListItem }) {
  return (
    <Row
      lead={
        <ChipList>
          <li>
            <Chip tone={item.waitingOn === "jackson" ? "you" : "neutral"}>{STAGE_LABELS[item.stage]}</Chip>
          </li>
        </ChipList>
      }
      trail={<Age at={item.foundAt} label="Found" prefix="found" suffix="ago" />}
    >
      <p>
        <ItemTitleLink item={item} />
        {item.isPublic === false ? (
          <>
            {" "}
            <NotPublicChip />
          </>
        ) : null}
      </p>
      <RowNote>
        {waitingPhrase(item.waitingOn)} ·{" "}
        {!item.disclosed ? (
          UNDISCLOSED_NOTE
        ) : item.lastValidatedAt !== null ? (
          <>
            last validated <DateText at={item.lastValidatedAt} />
          </>
        ) : (
          "not yet validated"
        )}
      </RowNote>
    </Row>
  );
}

function Candidates({ items }: { items: ListItem[] }) {
  const list = candidates(items);
  const hidden = list.filter((item) => !item.disclosed).length;
  return (
    <Section
      note={
        list.length > 0
          ? `${plural(list.length, "item", "items")} not yet routed${hidden > 0 ? ` · ${hidden} undisclosed` : ""}`
          : undefined
      }
      title="Candidates"
    >
      <Box>
        {list.length === 0 ? (
          <EmptyNote>No candidates are being checked right now.</EmptyNote>
        ) : (
          <RowList>
            {list.map((item) => (
              <CandidateRow item={item} key={item.id} />
            ))}
          </RowList>
        )}
      </Box>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Recently closed
// ---------------------------------------------------------------------------

function ClosedRow({ item }: { item: ListItem }) {
  return (
    <Row
      lead={<RefLead link={item.primaryLink} />}
      trail={<Age at={closedTime(item)} label="Closed" suffix="ago" />}
    >
      <p>
        <ItemTitleLink item={item} />
      </p>
      <ChipList className="mt-1">
        {item.isPublic === false ? (
          <li>
            <NotPublicChip />
          </li>
        ) : null}
        {item.outcome ? (
          <li>
            <OutcomeChip outcome={item.outcome} />
          </li>
        ) : null}
        {item.followUpState === "owed" || item.followUpState === "done" ? (
          <li>
            <FollowUpChip state={item.followUpState} />
          </li>
        ) : null}
      </ChipList>
      {!item.disclosed ? (
        <RowNote>Details of this candidate were not disclosed.</RowNote>
      ) : item.followUpNote ? (
        <RowNote>J5 follow-up: {item.followUpNote}</RowNote>
      ) : null}
    </Row>
  );
}

function RecentlyClosed({ items, total }: { items: ListItem[]; total: number }) {
  const list = recentlyClosed(items, CLOSED_SHOWN);
  return (
    <Section note={total > 0 ? `latest ${list.length} of ${total}` : undefined} title="Recently closed">
      <Box>
        {list.length === 0 ? (
          <EmptyNote>Nothing has closed yet.</EmptyNote>
        ) : (
          <RowList>
            {list.map((item) => (
              <ClosedRow item={item} key={item.id} />
            ))}
          </RowList>
        )}
      </Box>
      {total > list.length ? (
        <p className="mt-2 text-xs">
          <Link className={LINK} to={itemsHref({ stage: "closed" })}>
            All {total} closed items
          </Link>
        </p>
      ) : null}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

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
        {overview.sync.lastGithubSyncAt !== null ? <SyncLine owner={owner} sync={overview.sync} /> : null}
        <Box className="mt-8">
          <div className="px-3.5 py-4">
            <h2 className="font-semibold">No items have been recorded yet</h2>
            <p className={cx("mt-1", TEXT_MUTED)}>
              Items appear here when a J5 agent records a candidate fix.{" "}
              <Link className={LINK} to="/about">
                How it works
              </Link>
            </p>
          </div>
        </Box>
      </>
    );
  }
  return (
    <>
      <SyncLine owner={owner} sync={overview.sync} />
      <Tiles items={items} overview={overview} />
      <NeedsJackson asks={overview.openAsks} items={items} />
      <OurMove items={items} />
      <Pipeline pipeline={overview.pipeline} />
      <Offered asks={overview.openAsks} items={items} owner={owner} />
      <Candidates items={items} />
      <RecentlyClosed items={items} total={overview.stats.closed} />
    </>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <Skeleton label="Loading the overview" rows={3} />
      <Skeleton label="Loading the overview" rows={5} />
    </>
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
