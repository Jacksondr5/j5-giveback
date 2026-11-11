// All items: one table of everything, grouped by stage, with filters that live in the URL.

import { Link, navigate, useLocation } from "lakebed/client";
import type { ComponentChildren } from "preact";
import {
  OUTCOMES,
  OUTCOME_LABELS,
  ROUTE_LABELS,
  STAGES,
  STAGE_LABELS,
  WAITING_ON,
  WAITING_ON_LABELS,
  isOneOf,
  type Stage
} from "../../shared/enums";
import { Icon } from "../components/icons";
import { AskTag, OutcomeTag, SideKey, ThreadSignals, ThreadToken, UpstreamChanged, Waiting } from "../components/marks";
import { Age, CARD, FOCUS, ItemTitleLink, LINK, SERIF, Skeleton, TEXT_DIM, YOU_TAG, cx } from "../components/ui";
import { client, useTitle, useViewer } from "../data";
import { openAsksByItem, repositories, sortForList, type ListAsk, type ListItem } from "../lib/derive";
import {
  NO_FILTERS,
  applyFilters,
  closedWithoutOffer,
  filtersToSearch,
  hasFilters,
  hidesClosedWithoutOffer,
  parseFilters,
  type ItemFilters
} from "../lib/filters";
import { askAction, groupByStage, listThreads, stageCounts, stageIcon, stageWaitsOnJackson } from "../lib/present";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const CONTROL = cx(
  FOCUS,
  "block h-8 w-full min-w-0 rounded border border-(color:--edge) bg-(--card) px-2 text-sm text-(color:--ink) placeholder:text-(color:--dim)"
);

function Select({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="sr-only">{label}</span>
      <select
        className={CONTROL}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value || null)}
        value={value ?? ""}
      >
        {/* The empty choice names the filter, so the control needs no caption above it. */}
        <option value="">{label}: any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const STAGE_TAB = cx(FOCUS, "flex items-center gap-1.5 whitespace-nowrap rounded border px-2 py-1 text-sm leading-5");

function StageTabs({ filters, counts, total }: { filters: ItemFilters; counts: Map<Stage, number>; total: number }) {
  const tab = (stage: Stage | null, label: string, count: number, icon: ComponentChildren) => {
    const current = filters.stage === stage;
    return (
      <li key={stage ?? "all"}>
        <Link
          aria-current={current ? "true" : undefined}
          className={cx(
            STAGE_TAB,
            current
              ? "border-(color:--ink) bg-(--ink) font-semibold text-(color:--card)"
              : "border-(color:--rule) bg-(--card) hover:border-(color:--edge)"
          )}
          replace
          to={`/items${filtersToSearch({ ...filters, stage })}`}
        >
          {icon}
          {label}
          <span className={cx("tabular-nums", current ? undefined : TEXT_DIM)}>{count}</span>
        </Link>
      </li>
    );
  };
  return (
    <ul aria-label="Stage" className="flex flex-wrap gap-1.5">
      {tab(null, "All", total, null)}
      {STAGES.map((stage) => tab(stage, STAGE_LABELS[stage], counts.get(stage) ?? 0, <Icon name={stageIcon(stage)} size={14} />))}
    </ul>
  );
}

function Filters({ filters, items }: { filters: ItemFilters; items: ListItem[] }) {
  // The URL is the state. Replacing the entry keeps Back leaving the list in one step.
  function set(patch: Partial<ItemFilters>) {
    navigate(`/items${filtersToSearch({ ...filters, ...patch })}`, { replace: true });
  }
  const repos = repositories(items);
  // A repository named in the URL stays selectable even when no listed item targets it.
  const repoOptions = filters.repo && !repos.includes(filters.repo) ? [...repos, filters.repo] : repos;
  return (
    <div aria-label="Filter items" className="space-y-2" role="search">
      <StageTabs counts={stageCounts(items)} filters={filters} total={items.length} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,22rem)_repeat(3,minmax(0,13rem))]">
        <label className="relative col-span-2 block min-w-0 md:col-span-1">
          <span className="sr-only">Search ID, title or ref</span>
          <Icon className={cx("pointer-events-none absolute left-2 top-2", TEXT_DIM)} name="search" />
          <input
            className={cx(CONTROL, "pl-8")}
            onInput={(event) => set({ q: (event.currentTarget as HTMLInputElement).value })}
            placeholder="Search title, GB-12 or #33420"
            type="search"
            value={filters.q}
          />
        </label>
        <Select
          label="Waiting on"
          onChange={(value) => set({ waiting: isOneOf(WAITING_ON, value) ? value : null })}
          options={WAITING_ON.map((waitingOn) => ({ value: waitingOn, label: WAITING_ON_LABELS[waitingOn] }))}
          value={filters.waiting}
        />
        <Select
          label="Outcome"
          onChange={(value) => set({ outcome: isOneOf(OUTCOMES, value) ? value : null })}
          options={OUTCOMES.map((outcome) => ({ value: outcome, label: OUTCOME_LABELS[outcome] }))}
          value={filters.outcome}
        />
        <label className="col-span-2 block min-w-0 md:col-span-1">
          <span className="sr-only">Repository</span>
          <select
            className={CONTROL}
            onChange={(event) => set({ repo: (event.currentTarget as HTMLSelectElement).value || null })}
            value={filters.repo ?? ""}
          >
            <option value="">Repository: any</option>
            {repoOptions.map((repo) => (
              <option key={repo} value={repo}>
                {repo}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function None({ label }: { label: string }) {
  return (
    <span className={TEXT_DIM}>
      <span aria-hidden="true">–</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The item's threads, ours first, each with its side, its live state and what it is to the item. */
function Threads({ item }: { item: ListItem }) {
  const threads = listThreads(item);
  if (threads.length === 0) return item.disclosed ? <None label="Nothing posted upstream" /> : <None label="Withheld" />;
  return (
    <ul className="space-y-1">
      {threads.map((link) => (
        <li key={link.id}>
          <ThreadToken link={link} role />
        </li>
      ))}
    </ul>
  );
}

/** CI, review, the review bot and triage for the item's primary thread, and the upstream-changed marker. */
function Checks({ item }: { item: ListItem }) {
  const link = item.primaryLink;
  const signals = link !== null && (link.ci !== null || link.reviewDecision !== null || link.macroscopeVerdict !== null || link.triageBucket !== null || link.triageRank !== null);
  if (!signals && item.upstreamChangedAt === null) return <None label="No checks" />;
  return (
    <div className="space-y-0.5">
      {link ? <ThreadSignals link={link} /> : null}
      {item.upstreamChangedAt !== null ? <UpstreamChanged note={item.upstreamChangeNote} /> : null}
    </div>
  );
}

/** How a closed item ended; for an open one, what Jackson is asked to do about it and what it waits on. */
function Status({ item, asks }: { item: ListItem; asks: ListAsk[] }) {
  if (item.outcome) return <OutcomeTag outcome={item.outcome} />;
  const jackson = item.waitingOn === "jackson";
  if (asks.length === 0 && item.waitingOn === "nobody") return <None label="Waits on nobody" />;
  return (
    <div className="flex flex-col items-start gap-y-1">
      {asks.map((ask) => (
        <AskTag key={ask.id}>{askAction(ask.kind, ask.label).action}</AskTag>
      ))}
      {jackson && asks.length > 0 ? null : item.waitingOn === "nobody" ? null : <Waiting waitingOn={item.waitingOn} />}
    </div>
  );
}

function GroupHeading({ stage, count }: { stage: Stage; count: number }) {
  const hot = stageWaitsOnJackson(stage);
  return (
    <span className="flex items-center gap-2">
      <span className={cx("inline-flex items-center gap-1.5 rounded px-1.5 py-0.5", SERIF, "text-base font-bold leading-5", hot && YOU_TAG)}>
        <Icon name={stageIcon(stage)} />
        {STAGE_LABELS[stage]}
      </span>
      <span className={cx("text-sm font-normal tabular-nums", TEXT_DIM)}>{count}</span>
    </span>
  );
}

type Group = { stage: Stage; items: ListItem[] };

const TH = "px-3 py-1.5 text-left align-bottom text-xs font-normal";
const TD = "px-3 py-2 align-top";

function Table({ groups, asks }: { groups: Group[]; asks: Map<string, ListAsk[]> }) {
  return (
    <table className="w-full table-fixed border-collapse">
      <caption className="sr-only">Giveback items, grouped by stage</caption>
      <colgroup>
        <col />
        <col className="w-[24%]" />
        <col className="w-[12%]" />
        <col className="w-[18%]" />
        <col className="w-[9%]" />
        <col className="w-[6.5rem]" />
      </colgroup>
      <thead>
        <tr className={cx("border-b border-(color:--rule)", TEXT_DIM)}>
          <th className={TH} scope="col">
            Item
          </th>
          <th className={TH} scope="col">
            <span className="flex flex-wrap gap-x-3">
              Threads <SideKey />
            </span>
          </th>
          <th className={TH} scope="col">
            Checks
          </th>
          <th className={TH} scope="col">
            Needs, waits on, or outcome
          </th>
          <th className={TH} scope="col">
            Route
          </th>
          <th className={cx(TH, "text-right")} scope="col">
            Found
          </th>
        </tr>
      </thead>
      {groups.map((group) => (
        <tbody key={group.stage}>
          <tr className="border-y border-(color:--rule) bg-(--paper)">
            <th className="px-3 py-1.5 text-left" colSpan={6} scope="rowgroup">
              <GroupHeading count={group.items.length} stage={group.stage} />
            </th>
          </tr>
          {group.items.map((item) => (
            <tr className="border-t border-(color:--rule) first:border-t-0" key={item.id}>
              <th className={cx(TD, "text-left font-normal")} scope="row">
                <ItemTitleLink item={item} notPublic={item.isPublic === false} />
              </th>
              <td className={TD}>
                <Threads item={item} />
              </td>
              <td className={TD}>
                <Checks item={item} />
              </td>
              <td className={TD}>
                <Status asks={asks.get(item.id) ?? []} item={item} />
              </td>
              <td className={cx(TD, "text-sm")}>{item.route ? ROUTE_LABELS[item.route] : <None label="No route yet" />}</td>
              <td className={cx(TD, "whitespace-nowrap text-right text-sm")}>
                <Age at={item.foundAt} label="Found" suffix="ago" />
              </td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}

/** The same rows for a narrow screen: each item is a short stack, so nothing scrolls sideways. */
function Stack({ groups, asks }: { groups: Group[]; asks: Map<string, ListAsk[]> }) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.stage}>
          <h2 className="border-y border-(color:--rule) bg-(--paper) px-3 py-1.5 first:border-t-0">
            <GroupHeading count={group.items.length} stage={group.stage} />
          </h2>
          <ul className="divide-y divide-(color:--rule)">
            {group.items.map((item) => (
              <li className="px-3 py-2.5" key={item.id}>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0">
                    <ItemTitleLink item={item} notPublic={item.isPublic === false} />
                  </p>
                  <Age at={item.foundAt} className={cx("pt-0.5 text-sm", TEXT_DIM)} label="Found" prefix="found" suffix="ago" />
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  {item.outcome ? (
                    <OutcomeTag outcome={item.outcome} />
                  ) : (
                    <>
                      {(asks.get(item.id) ?? []).map((ask) => (
                        <AskTag key={ask.id}>{askAction(ask.kind, ask.label).action}</AskTag>
                      ))}
                      {item.waitingOn === "nobody" || (item.waitingOn === "jackson" && (asks.get(item.id) ?? []).length > 0) ? null : (
                        <Waiting waitingOn={item.waitingOn} />
                      )}
                    </>
                  )}
                  {item.route ? <span className={cx("text-sm", TEXT_DIM)}>Route: {ROUTE_LABELS[item.route]}</span> : null}
                </div>
                {listThreads(item).length > 0 || item.upstreamChangedAt !== null ? (
                  <div className="mt-1.5 space-y-1">
                    <Threads item={item} />
                    {item.primaryLink ? <ThreadSignals link={item.primaryLink} /> : null}
                    {item.upstreamChangedAt !== null ? <UpstreamChanged note={item.upstreamChangeNote} /> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function ItemsBody({ items, openAsks }: { items: ListItem[] | undefined; openAsks: ListAsk[] | undefined }) {
  const { search } = useLocation();
  const filters = parseFilters(search);
  if (items === undefined) {
    return <Skeleton label="Loading the items" rows={8} />;
  }
  if (items.length === 0) {
    return <p className={cx(CARD, "mt-4 max-w-2xl px-3.5 py-4", TEXT_DIM)}>No items have been recorded yet.</p>;
  }
  const shown = sortForList(applyFilters(items, filters));
  const groups = groupByStage(shown);
  // The open asks arrive with the overview query. Until they do, rows show what they wait on and no action.
  const asks = openAsksByItem(openAsks ?? []);
  const filtered = hasFilters(filters);
  // Candidates closed without an offer are left out unless asked for. Say how many, and offer them.
  const hiding = hidesClosedWithoutOffer(filters);
  const hidden = hiding ? applyFilters(items, { ...filters, all: true }).filter(closedWithoutOffer).length : 0;
  return (
    <>
      <Filters filters={filters} items={items} />
      <p aria-live="polite" className={cx("mt-3 text-sm", TEXT_DIM)}>
        {filtered || hidden > 0 ? `${shown.length} of ${items.length} items` : `${items.length} items`}
        {hidden > 0 ? (
          <>
            {" · "}
            {hidden} closed without an offer hidden{" "}
            <Link className={cx(LINK, "ml-1")} replace to={`/items${filtersToSearch({ ...filters, all: true })}`}>
              Show all
            </Link>
          </>
        ) : filters.all ? (
          <Link className={cx(LINK, "ml-2")} replace to={`/items${filtersToSearch({ ...filters, all: false })}`}>
            Hide closed without an offer
          </Link>
        ) : null}
        {filtered ? (
          <Link className={cx(LINK, "ml-2")} replace to={`/items${filtersToSearch({ ...NO_FILTERS, all: filters.all })}`}>
            Clear filters
          </Link>
        ) : null}
      </p>
      <div className={cx(CARD, "mt-2 overflow-hidden")}>
        {shown.length === 0 ? (
          <p className={cx("px-3.5 py-4", TEXT_DIM)}>No items match these filters.</p>
        ) : (
          <>
            <div className="hidden lg:block">
              <Table asks={asks} groups={groups} />
            </div>
            <div className="lg:hidden">
              <Stack asks={asks} groups={groups} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

function PublicItems() {
  return <ItemsBody items={client.useQuery("items")} openAsks={client.useQuery("overview")?.openAsks} />;
}

function OwnerItems() {
  return <ItemsBody items={client.useQuery("ownerItems")} openAsks={client.useQuery("ownerOverview")?.openAsks} />;
}

export function ItemsPage() {
  useTitle("All items");
  const viewer = useViewer();
  return (
    <>
      <h1 className={cx(SERIF, "pb-3 pt-4 text-2xl font-bold leading-8")}>All items</h1>
      {viewer === undefined ? (
        <Skeleton label="Loading the items" rows={8} />
      ) : viewer.isOwner ? (
        <OwnerItems />
      ) : (
        <PublicItems />
      )}
    </>
  );
}
