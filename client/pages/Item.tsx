// One item: where it is, why it took its route, every upstream thread, and its history.

import { Link, useParams } from "lakebed/client";
import type { ComponentChildren } from "preact";
import type {
  EventView,
  ItemDetailView,
  ItemPrivateView,
  LinkView,
  OwnerItemDetailView
} from "../../shared/api";
import {
  ASK_KIND_LABELS,
  EVENT_ACTOR_LABELS,
  EVENT_TYPE_LABELS,
  FOLLOW_UP_STATE_LABELS,
  LINK_KIND_LABELS,
  LINK_OWNERSHIP_LABELS,
  LINK_ROLE_LABELS,
  MAIN_PATH_STAGES,
  OUTCOME_LABELS,
  ROUTE_LABELS,
  STAGES,
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  type Stage
} from "../../shared/enums";
import {
  CiChip,
  LinkStateChip,
  MacroscopeChip,
  NotPublicChip,
  OutcomeChip,
  ReviewChip,
  StageChip,
  TriageChip,
  UpstreamChangedChip,
  WaitingChip,
  stageWaitsOnJackson
} from "../components/chips";
import {
  Age,
  Box,
  Chip,
  ChipList,
  DateText,
  EmptyNote,
  ExternalLink,
  LINK,
  MONO,
  OwnerOnly,
  Section,
  Skeleton,
  TEXT_MUTED,
  cx
} from "../components/ui";
import { client, useTitle, useViewer } from "../data";
import { asksForItem, linksByRole, type ListAsk, type ListItem } from "../lib/derive";
import { fullRef, originRefUrl, shortSha } from "../lib/format";
import { NotFound } from "./NotFound";

type Detail = (ItemDetailView | OwnerItemDetailView) & { private?: ItemPrivateView | null };

// ---------------------------------------------------------------------------
// Stage tracker
// ---------------------------------------------------------------------------

/**
 * The main path as numbered steps. Held is a side stop, so it appears only on a
 * held item, where it is the current position: on any other item it would read
 * as a step that was passed or is still to come, and it is neither.
 *
 * On a held item the steps before Held are not all behind it. Found and
 * Validating are, because a held item is valid. Deciding is only when a route
 * was recorded; otherwise it was skipped, and it shows as not reached.
 */
function StageTracker({ stage, routeChosen }: { stage: Stage; routeChosen: boolean }) {
  const held = stage === "held";
  const shown: readonly Stage[] = held ? STAGES : MAIN_PATH_STAGES;
  const current = shown.indexOf(stage);
  return (
    <>
      <ol aria-label="Stage" className={cx("grid grid-cols-4 gap-1", held ? "md:grid-cols-8" : "md:grid-cols-7")}>
        {shown.map((entry, index) => {
          const here = index === current;
          const hot = here && stageWaitsOnJackson(entry);
          const passed = index < current && !(held && entry === "deciding" && !routeChosen);
          return (
            <li
              aria-current={here ? "step" : undefined}
              className={cx(
                "rounded-md border px-1.5 py-2 text-center text-xs",
                hot
                  ? "border-amber-600 bg-amber-100 font-semibold text-amber-950 dark:border-amber-500 dark:bg-amber-950 dark:text-amber-100"
                  : here
                    ? "border-stone-900 bg-white font-semibold dark:border-stone-100 dark:bg-stone-900"
                    : passed
                      ? "border-stone-300 bg-stone-100 dark:border-stone-700 dark:bg-stone-800"
                      : cx("border-dashed border-stone-300 dark:border-stone-700", TEXT_MUTED)
              )}
              key={entry}
            >
              {entry === "held" ? (
                <span className="block font-normal">side stop</span>
              ) : (
                <span className="block tabular-nums">{MAIN_PATH_STAGES.indexOf(entry) + 1}</span>
              )}
              <span className="block">{STAGE_LABELS[entry]}</span>
              <span className="block text-[0.6875rem] font-normal">
                {here ? "now" : passed ? "passed" : <span aria-hidden="true">&nbsp;</span>}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={cx("mt-2 text-xs", TEXT_MUTED)}>
        {STAGE_LABELS[stage]}: {STAGE_DESCRIPTIONS[stage]}{" "}
        {held
          ? "Held is off the main path. The item closes or goes back onto the path when that change merges or is dropped."
          : "An item can move back a stage when upstream changes."}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function Facts({ children }: { children: ComponentChildren }) {
  return <dl className="divide-y divide-stone-200 dark:divide-stone-800">{children}</dl>;
}

function Fact({ term, children }: { term: string; children: ComponentChildren }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 px-3.5 py-2 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className={cx("text-xs sm:pt-0.5", TEXT_MUTED)}>{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upstream links
// ---------------------------------------------------------------------------

function LinkCard({ link }: { link: LinkView }) {
  return (
    <li className="px-3.5 py-3">
      <p className={cx("text-xs", TEXT_MUTED)}>
        {LINK_ROLE_LABELS[link.role]} · {LINK_OWNERSHIP_LABELS[link.ownership]} · {LINK_KIND_LABELS[link.kind]}
      </p>
      <p className="mt-0.5">
        <ExternalLink className={cx(LINK, MONO, "break-words")} href={link.url}>
          {fullRef(link.repo, link.number)}
        </ExternalLink>
        {link.title ? <span className="font-medium"> {link.title}</span> : null}
      </p>
      <ChipList className="mt-1.5">
        <li>
          <LinkStateChip link={link} />
        </li>
        {link.ci ? (
          <li>
            <CiChip ci={link.ci} />
          </li>
        ) : null}
        {link.reviewDecision ? (
          <li>
            <ReviewChip decision={link.reviewDecision} />
          </li>
        ) : null}
        {link.macroscopeVerdict ? (
          <li>
            <MacroscopeChip verdict={link.macroscopeVerdict} />
          </li>
        ) : null}
        {link.triageBucket !== null || link.triageRank !== null ? (
          <li>
            <TriageChip bucket={link.triageBucket} rank={link.triageRank} />
          </li>
        ) : null}
        {link.labels.map((label) => (
          <li key={label}>
            <Chip title="GitHub label">{label}</Chip>
          </li>
        ))}
      </ChipList>
      <p className={cx("mt-1.5 text-xs", TEXT_MUTED)}>
        {link.mergedAt !== null ? (
          <>
            Merged <DateText at={link.mergedAt} /> ·{" "}
          </>
        ) : link.closedAt !== null ? (
          <>
            Closed <DateText at={link.closedAt} /> ·{" "}
          </>
        ) : null}
        {link.lastActivityAt !== null ? (
          <>
            Last activity <Age at={link.lastActivityAt} suffix="ago" />
          </>
        ) : (
          "No activity read yet"
        )}
        {link.lastOtherActivityAt !== null ? (
          <>
            {" "}
            · last heard from {link.lastOtherActivityBy ?? "someone else"} <Age at={link.lastOtherActivityAt} suffix="ago" />
          </>
        ) : null}
        {link.headSha ? (
          <>
            {" "}
            · head <span className={MONO}>{shortSha(link.headSha)}</span>
          </>
        ) : null}
        {link.syncedAt !== null ? (
          <>
            {" "}
            · synced <Age at={link.syncedAt} suffix="ago" />
          </>
        ) : null}
      </p>
      {link.syncError ? (
        <p className="mt-1 text-xs font-medium">The last sync could not read this thread: {link.syncError}</p>
      ) : null}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Asks
// ---------------------------------------------------------------------------

function AskEntry({ ask }: { ask: ListAsk }) {
  const open = ask.closedAt === null;
  const recommendation = ask.private?.recommendation ?? null;
  const draftPointer = ask.private?.draftPointer ?? null;
  return (
    <li>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3.5 py-2.5">
        <div className="min-w-0">
          <ChipList>
            <li>
              <Chip tone={open ? "you" : "neutral"}>{ASK_KIND_LABELS[ask.kind]}</Chip>
            </li>
            <li>
              <Chip tone="neutral">{open ? "Open" : "Answered"}</Chip>
            </li>
          </ChipList>
          {ask.label ? <p className="mt-1">{ask.label}</p> : null}
          {ask.resolution ? <p className={cx("mt-0.5 text-xs", TEXT_MUTED)}>Answer: {ask.resolution}</p> : null}
        </div>
        <p className={cx("text-xs", open ? "" : TEXT_MUTED)}>
          {ask.closedAt === null ? (
            <Age at={ask.openedAt} label="Asked" prefix="open" />
          ) : (
            <>
              asked <DateText at={ask.openedAt} />, answered <DateText at={ask.closedAt} />
            </>
          )}
        </p>
      </div>
      {recommendation || draftPointer ? (
        <OwnerOnly>
          {recommendation ? <p className="whitespace-pre-wrap break-words">Recommendation: {recommendation}</p> : null}
          {draftPointer ? <p className="break-words">Draft: {draftPointer}</p> : null}
        </OwnerOnly>
      ) : null}
    </li>
  );
}

function Asks({ asks }: { asks: ListAsk[] }) {
  const { open, closed } = asksForItem(asks);
  return (
    <Section
      note={asks.length > 0 ? `${open.length} open · ${closed.length} answered` : undefined}
      title="Asks to Jackson"
    >
      <Box accent={open.length > 0}>
        {asks.length === 0 ? (
          <EmptyNote>Nothing has been asked of Jackson for this item.</EmptyNote>
        ) : (
          <ul className="divide-y divide-stone-200 dark:divide-stone-800">
            {[...open, ...closed].map((ask) => (
              <AskEntry ask={ask} key={ask.id} />
            ))}
          </ul>
        )}
      </Box>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function TimelineEntry({ event }: { event: EventView }) {
  return (
    <li className="grid gap-x-4 gap-y-0.5 px-3.5 py-2.5 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <p className={cx("text-xs sm:pt-0.5", TEXT_MUTED)}>
        <DateText at={event.at} />
      </p>
      <div className="min-w-0">
        <p className={cx("text-xs", TEXT_MUTED)}>
          {EVENT_TYPE_LABELS[event.type]} · {EVENT_ACTOR_LABELS[event.actor]}
          {event.isPublic ? null : (
            <>
              {" "}
              <Chip tone="owner">Owner only</Chip>
            </>
          )}
        </p>
        <p className="break-words">
          {event.note}
          {event.url ? (
            <>
              {" "}
              <ExternalLink href={event.url}>View on GitHub</ExternalLink>
            </>
          ) : null}
        </p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function Header({ item }: { item: ListItem }) {
  return (
    <>
      <p className={cx("mt-6 text-xs", TEXT_MUTED)}>
        <Link className={LINK} to="/items">
          All items
        </Link>{" "}
        <span aria-hidden="true">/</span> {item.targetRepo ?? "undisclosed"}
      </p>
      <h1 className="mt-1 text-xl font-semibold tracking-tight">{item.title}</h1>
      <ChipList className="mt-2">
        {item.isPublic === false ? (
          <li>
            <NotPublicChip />
          </li>
        ) : null}
        <li>
          <StageChip stage={item.stage} />
        </li>
        {item.outcome ? (
          <li>
            <OutcomeChip outcome={item.outcome} />
          </li>
        ) : null}
        {item.stage !== "closed" || item.waitingOn !== "nobody" ? (
          <li>
            <WaitingChip waitingOn={item.waitingOn} />
          </li>
        ) : null}
        {item.upstreamChangedAt !== null ? (
          <li>
            <UpstreamChangedChip note={item.upstreamChangeNote} />
          </li>
        ) : null}
      </ChipList>
    </>
  );
}

function Undisclosed({ detail }: { detail: Detail }) {
  const { item } = detail;
  return (
    <>
      <Header item={item} />
      <p className="mt-3 max-w-2xl">
        This is a candidate fix whose details are withheld until it is offered upstream. Its stage, what it waits on
        and its dates are public; its title, summary and upstream threads are not.
      </p>
      <Section title="Where it is">
        {/* The route of an undisclosed item is withheld, so its tracker never claims a decision. */}
        <StageTracker routeChosen={false} stage={item.stage} />
      </Section>
      <Section title="Dates">
        <Box>
          <Facts>
            <Fact term="Found">
              <DateText at={item.foundAt} />
            </Fact>
            <Fact term="Waiting since">
              <DateText at={item.waitingSince} /> (<Age at={item.waitingSince} />)
            </Fact>
            <Fact term="Last updated">
              <DateText at={item.updatedAt} />
            </Fact>
          </Facts>
        </Box>
      </Section>
    </>
  );
}

function Disclosed({ detail }: { detail: Detail }) {
  const { item, events } = detail;
  const links = linksByRole(detail.links);
  const privateFields = detail.private ?? null;
  const hasPrivate = privateFields !== null && Boolean(privateFields.notes || privateFields.impact || privateFields.preparedBranch);
  return (
    <>
      <Header item={item} />
      {item.summary ? <p className="mt-3 max-w-2xl">{item.summary}</p> : null}
      {item.upstreamChangedAt !== null ? (
        <p className="mt-2 max-w-2xl text-[0.8125rem]">
          <span className="font-semibold">Changed upstream</span> <Age at={item.upstreamChangedAt} suffix="ago" />:{" "}
          {item.upstreamChangeNote ?? "an upstream thread this item depends on changed state."} The giveback agent has
          not yet acted on it.
        </p>
      ) : null}

      <Section title="Where it is">
        <StageTracker routeChosen={item.route !== null} stage={item.stage} />
      </Section>

      {hasPrivate && privateFields ? (
        <Section title="Private notes">
          <div className="overflow-hidden rounded-md border border-dashed border-stone-400 dark:border-stone-600">
            <OwnerOnly className="border-t-0">
              <dl className="space-y-2">
                {privateFields.notes ? (
                  <div>
                    <dt className={cx("text-xs", TEXT_MUTED)}>Notes</dt>
                    <dd className="whitespace-pre-wrap break-words">{privateFields.notes}</dd>
                  </div>
                ) : null}
                {privateFields.impact ? (
                  <div>
                    <dt className={cx("text-xs", TEXT_MUTED)}>Impact on J5</dt>
                    <dd className="whitespace-pre-wrap break-words">{privateFields.impact}</dd>
                  </div>
                ) : null}
                {privateFields.preparedBranch ? (
                  <div>
                    <dt className={cx("text-xs", TEXT_MUTED)}>Prepared branch</dt>
                    <dd className={cx(MONO, "break-all")}>{privateFields.preparedBranch}</dd>
                  </div>
                ) : null}
              </dl>
            </OwnerOnly>
          </div>
        </Section>
      ) : null}

      <Section title="Route">
        <Box>
          <Facts>
            <Fact term="Route">
              {item.route ? ROUTE_LABELS[item.route] : <span className={TEXT_MUTED}>Not chosen yet</span>}
            </Fact>
            {item.routeReason ? <Fact term="Why this route">{item.routeReason}</Fact> : null}
            <Fact term="Waiting on">
              <WaitingChip waitingOn={item.waitingOn} /> <span className={TEXT_MUTED}>since</span>{" "}
              <DateText at={item.waitingSince} />
            </Fact>
            {item.outcome ? (
              <Fact term="Outcome">
                {OUTCOME_LABELS[item.outcome]}
                {item.closedAt !== null ? (
                  <>
                    {" "}
                    <span className={TEXT_MUTED}>on</span> <DateText at={item.closedAt} />
                  </>
                ) : null}
              </Fact>
            ) : null}
          </Facts>
        </Box>
      </Section>

      <Section note={links.length > 0 ? `${links.length} · live state from GitHub` : undefined} title="Upstream threads">
        <Box>
          {links.length === 0 ? (
            <EmptyNote>Nothing has been posted upstream for this item, and no upstream thread is tied to it.</EmptyNote>
          ) : (
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {links.map((link) => (
                <LinkCard key={link.id} link={link} />
              ))}
            </ul>
          )}
        </Box>
      </Section>

      <Asks asks={detail.asks} />

      <Section title="Details">
        <Box>
          <Facts>
            <Fact term="Upstream repository">
              {item.targetRepo ? (
                <ExternalLink className={cx(LINK, MONO)} href={`https://github.com/${item.targetRepo}`}>
                  {item.targetRepo}
                </ExternalLink>
              ) : (
                <span className={TEXT_MUTED}>Not set</span>
              )}
            </Fact>
            <Fact term="Found in J5 Code">
              {item.originRefs.length === 0 ? (
                <span className={TEXT_MUTED}>No origin recorded</span>
              ) : (
                <ul className="space-y-0.5">
                  {item.originRefs.map((ref) => {
                    const url = originRefUrl(ref);
                    return (
                      <li key={ref}>
                        {url ? (
                          <ExternalLink className={cx(LINK, MONO, "break-words")} href={url}>
                            {ref}
                          </ExternalLink>
                        ) : (
                          <span className="break-words">{ref}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Fact>
            <Fact term="Found">
              <DateText at={item.foundAt} />
            </Fact>
            <Fact term="Last validated">
              {item.lastValidatedAt !== null ? (
                <DateText at={item.lastValidatedAt} />
              ) : (
                <span className={TEXT_MUTED}>Not yet validated</span>
              )}
              {item.lastValidatedSha ? (
                <>
                  {" "}
                  <span className={TEXT_MUTED}>against upstream</span>{" "}
                  {item.targetRepo ? (
                    <ExternalLink
                      className={cx(LINK, MONO)}
                      href={`https://github.com/${item.targetRepo}/commit/${item.lastValidatedSha}`}
                    >
                      {shortSha(item.lastValidatedSha)}
                    </ExternalLink>
                  ) : (
                    <span className={MONO}>{shortSha(item.lastValidatedSha)}</span>
                  )}
                </>
              ) : null}
            </Fact>
            {item.validationVerdict ? <Fact term="Validation verdict">{item.validationVerdict}</Fact> : null}
            <Fact term="J5 follow-up">
              {item.followUpState && item.followUpState !== "none" ? (
                <>
                  <span className={item.followUpState === "owed" ? "font-medium" : undefined}>
                    {FOLLOW_UP_STATE_LABELS[item.followUpState]}
                  </span>
                  {item.followUpNote ? `: ${item.followUpNote}` : null}
                </>
              ) : (
                <span className={TEXT_MUTED}>{item.followUpNote ?? "None owed"}</span>
              )}
            </Fact>
            <Fact term="Last updated">
              <DateText at={item.updatedAt} />
            </Fact>
          </Facts>
        </Box>
      </Section>

      <Section note={events.length > 0 ? "newest first" : undefined} title="Timeline">
        <Box>
          {events.length === 0 ? (
            <EmptyNote>No history has been recorded for this item.</EmptyNote>
          ) : (
            <ol className="divide-y divide-stone-200 dark:divide-stone-800" reversed>
              {events.map((event) => (
                <TimelineEntry event={event} key={event.id} />
              ))}
            </ol>
          )}
        </Box>
      </Section>
    </>
  );
}

function ItemBody({ detail }: { detail: Detail | null | undefined }) {
  useTitle(detail ? detail.item.title : detail === null ? "Not found" : "Item");
  if (detail === undefined) {
    return (
      <>
        <Skeleton label="Loading the item" rows={3} />
        <Skeleton label="Loading the item" rows={5} />
      </>
    );
  }
  if (detail === null) {
    return <NotFound what="item" />;
  }
  return detail.item.disclosed ? <Disclosed detail={detail} /> : <Undisclosed detail={detail} />;
}

function PublicItem({ itemRef }: { itemRef: string }) {
  return <ItemBody detail={client.useQuery("item", itemRef)} />;
}

function OwnerItem({ itemRef }: { itemRef: string }) {
  return <ItemBody detail={client.useQuery("ownerItem", itemRef)} />;
}

export function ItemPage() {
  const { ref } = useParams<{ ref?: string }>();
  const viewer = useViewer();
  if (!ref) return <NotFound what="item" />;
  if (viewer === undefined) return <ItemBody detail={undefined} />;
  return viewer.isOwner ? <OwnerItem itemRef={ref} key={ref} /> : <PublicItem itemRef={ref} key={ref} />;
}
