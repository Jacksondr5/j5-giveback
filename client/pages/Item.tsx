// One item: where it is, what it needs, every upstream thread split into ours
// and theirs, why it took its route, and its history.

import { Link, useParams } from "lakebed/client";
import type { ComponentChildren } from "preact";
import type { EventView, ItemDetailView, ItemPrivateView, LinkView, OwnerItemDetailView } from "../../shared/api";
import {
  EVENT_ACTOR_LABELS,
  EVENT_TYPE_LABELS,
  FOLLOW_UP_STATE_LABELS,
  MAIN_PATH_STAGES,
  ROUTE_LABELS,
  STAGES,
  type Stage
} from "../../shared/enums";
import { Icon } from "../components/icons";
import { OutcomeTag, SideGlyph, StageTag, ThreadSignals, ThreadToken, UpstreamChanged, Waiting } from "../components/marks";
import { Rail, type Stop } from "../components/Rail";
import {
  Age,
  CARD,
  DIVIDE,
  DateText,
  ExternalLink,
  LINK,
  PRIVATE_BLOCK,
  PRIVATE_BOX,
  PRIVATE_TEXT,
  PRIVATE_TIP,
  PrivateBlock,
  REF,
  SERIF,
  Section,
  Skeleton,
  TEXT_DIM,
  UNDISCLOSED_TIP,
  cx,
  useNowValue
} from "../components/ui";
import { client, useTitle, useViewer } from "../data";
import { asksForItem, linksByRole, type ListAsk, type ListItem } from "../lib/derive";
import { WEEK, originRefUrl, shortSha } from "../lib/format";
import { askAction, commentHost, listThreads, roleHint, roleWord, stageWaitsOnJackson, threadSide } from "../lib/present";
import { NotFound } from "./NotFound";

type Detail = (ItemDetailView | OwnerItemDetailView) & { private?: ItemPrivateView | null };

// ---------------------------------------------------------------------------
// Stage tracker
// ---------------------------------------------------------------------------

// Stages a closed item passes only if it was really offered upstream.
const OFFER_PATH: readonly Stage[] = ["preparing", "approving", "offered"];

/**
 * The stops of the line for one item. Held is a side stop, so it appears only on
 * a held item, where it is the current position.
 *
 * `routeChosen` and `everOffered` keep the line honest about a held or closed
 * item: Deciding counts as passed only when a route was chosen, and Preparing
 * to Offered only when something of ours was posted upstream.
 */
function trackerStops(stage: Stage, routeChosen: boolean, everOffered: boolean): Stop[] {
  const held = stage === "held";
  const shown: readonly Stage[] = held ? STAGES : MAIN_PATH_STAGES;
  const current = shown.indexOf(stage);
  return shown.map((entry, index) => {
    const skipped =
      ((held || stage === "closed") && entry === "deciding" && !routeChosen) ||
      (stage === "closed" && OFFER_PATH.includes(entry) && !everOffered);
    return { stage: entry, mark: index === current ? "current" : index < current && !skipped ? "passed" : "ahead" };
  });
}

function Tracker({ stage, routeChosen, everOffered }: { stage: Stage; routeChosen: boolean; everOffered: boolean }) {
  return (
    <div className={cx(CARD, "px-2 py-3 sm:px-3")}>
      <Rail label="Stage" stops={trackerStops(stage, routeChosen, everOffered)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

function Facts({ children }: { children: ComponentChildren }) {
  return <dl className={cx(CARD, DIVIDE)}>{children}</dl>;
}

function Fact({ term, children }: { term: string; children: ComponentChildren }) {
  return (
    <div className="grid gap-x-4 gap-y-0.5 px-3.5 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]">
      <dt className={cx("text-sm", TEXT_DIM)}>{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upstream threads: ours and theirs
// ---------------------------------------------------------------------------

function ThreadCard({ link, links }: { link: LinkView; links: readonly LinkView[] }) {
  const host = commentHost(link, links);
  const word = roleWord(link.role);
  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ThreadToken full host={host} link={link} />
        {word ? (
          <span className="rounded border border-(color:--edge) px-1.5 text-xs leading-5" title={roleHint(link.role)}>
            {word}
          </span>
        ) : null}
      </div>
      {link.title ? <p className={cx(SERIF, "mt-1.5 text-[0.9375rem] leading-snug")}>{link.title}</p> : null}
      <ThreadSignals className="mt-1.5" link={link} words />
      {link.labels.length > 0 ? (
        <ul aria-label="GitHub labels" className="mt-1.5 flex flex-wrap gap-1">
          {link.labels.map((label) => (
            <li className="rounded-full border border-(color:--rule) px-2 text-xs leading-5" key={label}>
              {label}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={cx("mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs", TEXT_DIM)}>
        {link.mergedAt !== null ? (
          <span>
            merged <DateText at={link.mergedAt} />
          </span>
        ) : link.closedAt !== null ? (
          <span>
            closed <DateText at={link.closedAt} />
          </span>
        ) : null}
        {link.lastActivityAt !== null ? (
          <span>
            active <Age at={link.lastActivityAt} suffix="ago" />
          </span>
        ) : null}
        {link.lastOtherActivityAt !== null ? (
          <span title="The last comment or review by anyone other than Jackson, bots excluded">
            last heard from {link.lastOtherActivityBy ?? "someone else"} <Age at={link.lastOtherActivityAt} suffix="ago" />
          </span>
        ) : null}
        {link.headSha ? (
          <span>
            head <span className={REF}>{shortSha(link.headSha)}</span>
          </span>
        ) : null}
        {link.syncedAt !== null ? (
          <span>
            synced <Age at={link.syncedAt} suffix="ago" />
          </span>
        ) : (
          <span>not yet synced</span>
        )}
      </p>
      {link.syncError ? (
        <p className="mt-1 flex items-start gap-1.5 text-xs font-medium">
          <Icon className="mt-0.5" name="alert" size={12} />
          The last sync could not read this thread: {link.syncError}
        </p>
      ) : null}
    </li>
  );
}

function Lane({ ours, links, all }: { ours: boolean; links: LinkView[]; all: readonly LinkView[] }) {
  return (
    <div className={cx(CARD, "overflow-hidden", ours && "border-t-[3px] border-t-(color:--ink)")}>
      <h3 className="flex items-center gap-2 border-b border-(color:--rule) px-3.5 py-2 font-bold">
        {/* The same block the tokens use, so the heading is the key to them. */}
        <SideGlyph ours={ours} tone="dim">
          <Icon name="prOpen" size={14} />
        </SideGlyph>
        {ours ? "Ours" : "Theirs"}
        <span className={cx("font-normal tabular-nums", TEXT_DIM)}>{links.length}</span>
      </h3>
      {links.length === 0 ? (
        <p className={cx("px-3.5 py-3 text-sm", TEXT_DIM)}>
          {ours ? "Nothing of ours is posted upstream." : "No one else's thread is tied to this item."}
        </p>
      ) : (
        <ul className={DIVIDE}>
          {links.map((link) => (
            <ThreadCard key={link.id} link={link} links={all} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Threads({ links }: { links: LinkView[] }) {
  const sorted = linksByRole(links);
  return (
    <Section count={sorted.length} title="Upstream threads">
      {sorted.length === 0 ? (
        <p className={cx(CARD, "px-3.5 py-3", TEXT_DIM)}>Nothing is posted upstream, and no upstream thread is tied to this item.</p>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          <Lane all={sorted} links={sorted.filter((link) => threadSide(link) !== "theirs")} ours />
          <Lane all={sorted} links={sorted.filter((link) => threadSide(link) === "theirs")} ours={false} />
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Asks
// ---------------------------------------------------------------------------

function PrivateAsk({ ask }: { ask: ListAsk }) {
  const recommendation = ask.private?.recommendation ?? null;
  const draftPointer = ask.private?.draftPointer ?? null;
  if (!recommendation && !draftPointer) return null;
  return (
    <PrivateBlock className="mt-1.5">
      {recommendation ? <p className="whitespace-pre-wrap break-words">Recommendation: {recommendation}</p> : null}
      {draftPointer ? <p className="break-words">Draft: {draftPointer}</p> : null}
    </PrivateBlock>
  );
}

function OpenAsk({ ask }: { ask: ListAsk }) {
  const now = useNowValue();
  const old = now - ask.openedAt >= WEEK;
  const { action, detail } = askAction(ask.kind, ask.label);
  return (
    <li className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 px-3 py-2.5">
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
        <p className="max-w-[46rem] text-[0.9375rem] font-bold leading-6">{action}</p>
        {detail ? <p className={cx("max-w-[46rem] text-sm", TEXT_DIM)}>{detail}</p> : null}
        <PrivateAsk ask={ask} />
      </div>
    </li>
  );
}

function AnsweredAsk({ ask }: { ask: ListAsk }) {
  const { action, detail } = askAction(ask.kind, ask.label);
  return (
    <li className="px-3.5 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className="flex min-w-0 items-start gap-1.5">
          <Icon className={cx("mt-0.5", TEXT_DIM)} label="Answered" name="check" />
          <span>
            {action}
            {detail ? <span className={TEXT_DIM}> {detail}</span> : null}
          </span>
        </p>
        <p className={cx("text-xs", TEXT_DIM)}>
          asked <DateText at={ask.openedAt} />
          {ask.closedAt !== null ? (
            <>
              , answered <DateText at={ask.closedAt} />
            </>
          ) : null}
        </p>
      </div>
      {ask.resolution ? <p className="mt-0.5 pl-[1.375rem] text-sm">Answer: {ask.resolution}</p> : null}
      <div className="pl-[1.375rem]">
        <PrivateAsk ask={ask} />
      </div>
    </li>
  );
}

function Asks({ asks }: { asks: ListAsk[] }) {
  const { open, closed } = asksForItem(asks);
  if (asks.length === 0) return null;
  return (
    <>
      {open.length > 0 ? (
        <Section count={open.length} title="Needs Jackson">
          <ol className={cx(CARD, DIVIDE, "overflow-hidden border-l-4 border-l-(color:--you-solid)")}>
            {open.map((ask) => (
              <OpenAsk ask={ask} key={ask.id} />
            ))}
          </ol>
        </Section>
      ) : null}
      {closed.length > 0 ? (
        <Section count={closed.length} title="Answered asks">
          <ul className={cx(CARD, DIVIDE)}>
            {closed.map((ask) => (
              <AnsweredAsk ask={ask} key={ask.id} />
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function TimelineEntry({ event }: { event: EventView }) {
  return (
    <li className="grid gap-x-3 gap-y-0.5 px-3.5 py-2 sm:grid-cols-[6.5rem_minmax(0,1fr)]">
      <p className={cx("text-sm", TEXT_DIM)}>
        <DateText at={event.at} />
      </p>
      <div className={cx("min-w-0", event.isPublic ? undefined : PRIVATE_BLOCK)} title={event.isPublic ? undefined : PRIVATE_TIP}>
        <p className="text-sm">
          {event.isPublic ? null : <span className="sr-only">Only you see this: </span>}
          <span className="font-semibold">{EVENT_TYPE_LABELS[event.type]}</span>{" "}
          <span className={TEXT_DIM}>by {EVENT_ACTOR_LABELS[event.actor]}</span>
        </p>
        <p className="break-words">
          {event.note}
          {event.url ? (
            <>
              {" "}
              <ExternalLink href={event.url}>On GitHub</ExternalLink>
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

function Header({ item, links = [] }: { item: ListItem; links?: readonly LinkView[] }) {
  const notPublic = item.isPublic === false;
  const threads = listThreads(item);
  const hot = stageWaitsOnJackson(item.stage) && item.waitingOn === "jackson";
  return (
    <header className="pb-4 pt-4">
      <p className={cx("text-sm", TEXT_DIM)}>
        <Link className={LINK} to="/items">
          All items
        </Link>
        {item.targetRepo ? (
          <>
            {" "}
            <span aria-hidden="true">/</span> {item.targetRepo}
          </>
        ) : null}
      </p>
      <h1 className={cx(SERIF, "mt-1 max-w-5xl text-[1.75rem] font-bold leading-9", !item.disclosed && "italic")}>
        <span className={notPublic ? PRIVATE_TEXT : undefined} title={notPublic ? `Not public. ${PRIVATE_TIP}.` : undefined}>
          {item.title}
        </span>
        {notPublic ? <span className="sr-only"> (not public)</span> : null}
      </h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <StageTag hot={hot} stage={item.stage} />
        {item.outcome ? <OutcomeTag outcome={item.outcome} /> : null}
        {item.stage !== "closed" || item.waitingOn !== "nobody" ? (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {hot ? null : <Waiting waitingOn={item.waitingOn} />}
            <span className={cx("text-sm", TEXT_DIM)}>
              {hot ? "waiting" : "for"} <Age at={item.waitingSince} label="Waiting since" />
            </span>
          </span>
        ) : null}
        {item.upstreamChangedAt !== null ? <UpstreamChanged note={item.upstreamChangeNote} /> : null}
      </div>
      {threads.length > 0 ? (
        <ul aria-label="Main upstream threads" className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
          {threads.map((link) => (
            <li key={link.id}>
              <ThreadToken host={commentHost(link, links)} link={link} role />
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}

function Undisclosed({ detail }: { detail: Detail }) {
  const { item } = detail;
  return (
    <>
      <Header item={item} />
      <p className="max-w-2xl">{UNDISCLOSED_TIP}</p>
      <div className="mt-5 grid items-start gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]">
        {/* The route of an undisclosed item is withheld, so its line never claims a decision. */}
        <Tracker everOffered={false} routeChosen={false} stage={item.stage} />
        <Facts>
          <Fact term="Found">
            <DateText at={item.foundAt} />
          </Fact>
          <Fact term="Waiting since">
            <DateText at={item.waitingSince} /> <span className={TEXT_DIM}>(<Age at={item.waitingSince} />)</span>
          </Fact>
          <Fact term="Last updated">
            <DateText at={item.updatedAt} />
          </Fact>
        </Facts>
      </div>
    </>
  );
}

function PrivateNotes({ fields }: { fields: ItemPrivateView }) {
  return (
    <Section title="Private notes">
      <dl className={cx(PRIVATE_BOX, "space-y-2 bg-(--card) px-3.5 py-3")} title={PRIVATE_TIP}>
        {fields.notes ? (
          <div>
            <dt className={cx("text-sm", TEXT_DIM)}>Notes</dt>
            <dd className="whitespace-pre-wrap break-words">{fields.notes}</dd>
          </div>
        ) : null}
        {fields.impact ? (
          <div>
            <dt className={cx("text-sm", TEXT_DIM)}>Impact on J5</dt>
            <dd className="whitespace-pre-wrap break-words">{fields.impact}</dd>
          </div>
        ) : null}
        {fields.preparedBranch ? (
          <div>
            <dt className={cx("text-sm", TEXT_DIM)}>Prepared branch</dt>
            <dd className={cx(REF, "break-all")}>{fields.preparedBranch}</dd>
          </div>
        ) : null}
      </dl>
    </Section>
  );
}

function Details({ item }: { item: ListItem }) {
  return (
    <Section title="Details">
      <Facts>
        <Fact term="Route">{item.route ? ROUTE_LABELS[item.route] : <span className={TEXT_DIM}>Not chosen yet</span>}</Fact>
        {item.routeReason ? <Fact term="Why this route">{item.routeReason}</Fact> : null}
        <Fact term="Waiting on">
          <Waiting bare waitingOn={item.waitingOn} /> <span className={TEXT_DIM}>since</span> <DateText at={item.waitingSince} />
        </Fact>
        {item.outcome ? (
          <Fact term="Outcome">
            <OutcomeTag outcome={item.outcome} />
            {item.closedAt !== null ? (
              <>
                {" "}
                <span className={TEXT_DIM}>on</span> <DateText at={item.closedAt} />
              </>
            ) : null}
          </Fact>
        ) : null}
        <Fact term="Upstream repository">
          {item.targetRepo ? (
            <ExternalLink className={cx(LINK, REF)} href={`https://github.com/${item.targetRepo}`}>
              {item.targetRepo}
            </ExternalLink>
          ) : (
            <span className={TEXT_DIM}>Not set</span>
          )}
        </Fact>
        <Fact term="Found in J5 Code">
          {item.originRefs.length === 0 ? (
            <span className={TEXT_DIM}>No origin recorded</span>
          ) : (
            <ul className="space-y-0.5">
              {item.originRefs.map((ref) => {
                const url = originRefUrl(ref);
                return (
                  <li key={ref}>
                    {url ? (
                      <ExternalLink className={cx(LINK, REF, "break-words")} href={url}>
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
          {item.lastValidatedAt !== null ? <DateText at={item.lastValidatedAt} /> : <span className={TEXT_DIM}>Not yet validated</span>}
          {item.lastValidatedSha ? (
            <>
              {" "}
              <span className={TEXT_DIM}>against upstream</span>{" "}
              {item.targetRepo ? (
                <ExternalLink className={cx(LINK, REF)} href={`https://github.com/${item.targetRepo}/commit/${item.lastValidatedSha}`}>
                  {shortSha(item.lastValidatedSha)}
                </ExternalLink>
              ) : (
                <span className={REF}>{shortSha(item.lastValidatedSha)}</span>
              )}
            </>
          ) : null}
        </Fact>
        {item.validationVerdict ? <Fact term="Validation verdict">{item.validationVerdict}</Fact> : null}
        <Fact term="J5 follow-up">
          {item.followUpState && item.followUpState !== "none" ? (
            <>
              <span className={item.followUpState === "owed" ? "font-semibold" : undefined}>
                {FOLLOW_UP_STATE_LABELS[item.followUpState]}
              </span>
              {item.followUpNote ? `: ${item.followUpNote}` : null}
            </>
          ) : (
            <span className={TEXT_DIM}>{item.followUpNote ?? "None owed"}</span>
          )}
        </Fact>
        <Fact term="Last updated">
          <DateText at={item.updatedAt} />
        </Fact>
      </Facts>
    </Section>
  );
}

function Disclosed({ detail }: { detail: Detail }) {
  const { item, events } = detail;
  const privateFields = detail.private ?? null;
  const hasPrivate = privateFields !== null && Boolean(privateFields.notes || privateFields.impact || privateFields.preparedBranch);
  return (
    <>
      <Header item={item} links={detail.links} />
      {item.summary ? <p className="max-w-[46rem] text-[0.9375rem] leading-6">{item.summary}</p> : null}
      {item.upstreamChangedAt !== null ? (
        <p className="mt-2 max-w-[46rem]">
          <span className="font-semibold">Changed upstream</span> <Age at={item.upstreamChangedAt} suffix="ago" />:{" "}
          {item.upstreamChangeNote ?? "an upstream thread this item depends on changed state."} The giveback agent has
          not yet acted on it.
        </p>
      ) : null}

      {/*
        One column on a phone: where it is, what it needs, its threads, then the
        notes and details, then the history. From xl the notes and details are a
        sidebar beside all of it.
      */}
      <div className="mt-5 grid gap-x-8 gap-y-7 xl:grid-cols-[minmax(0,8fr)_minmax(0,5fr)] xl:grid-rows-[auto_1fr]">
        <div className="min-w-0 space-y-7 xl:col-start-1 xl:row-start-1">
          <Tracker
            everOffered={detail.links.some((link) => link.ownership === "ours")}
            routeChosen={item.route !== null && item.route !== "hold" && item.route !== "drop"}
            stage={item.stage}
          />
          <Asks asks={detail.asks} />
          <Threads links={detail.links} />
        </div>
        <div className="min-w-0 space-y-7 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          {hasPrivate && privateFields ? <PrivateNotes fields={privateFields} /> : null}
          <Details item={item} />
        </div>
        <Section className="min-w-0 xl:col-start-1 xl:row-start-2" count={events.length} title="Timeline">
          {events.length === 0 ? (
            <p className={cx(CARD, "px-3.5 py-3", TEXT_DIM)}>No history has been recorded for this item.</p>
          ) : (
            <ol className={cx(CARD, DIVIDE)} reversed>
              {events.map((event) => (
                <TimelineEntry event={event} key={event.id} />
              ))}
            </ol>
          )}
        </Section>
      </div>
    </>
  );
}

function ItemBody({ detail }: { detail: Detail | null | undefined }) {
  useTitle(detail ? detail.item.title : detail === null ? "Not found" : "Item");
  if (detail === undefined) {
    return (
      <div className="grid gap-x-8 xl:grid-cols-[minmax(0,8fr)_minmax(0,5fr)]">
        <Skeleton label="Loading the item" rows={5} />
        <Skeleton label="Loading the item" rows={5} />
      </div>
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
