// All items: one table of everything, with filters that live in the URL.

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
  isOneOf
} from "../../shared/enums";
import { NotPublicChip, OutcomeChip, StageChip, WaitingChip, linkState } from "../components/chips";
import { RefLink } from "../components/refs";
import { Age, Box, ChipList, FOCUS, ItemTitleLink, LINK, Skeleton, TEXT_MUTED, cx } from "../components/ui";
import { client, useTitle, useViewer } from "../data";
import { repositories, sortForList, type ListItem } from "../lib/derive";
import { applyFilters, filtersToSearch, hasFilters, parseFilters, type ItemFilters } from "../lib/filters";
import { shortKind } from "../lib/format";

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const CONTROL = cx(
  FOCUS,
  "mt-1 block h-8 w-full min-w-0 rounded border border-stone-400 bg-white px-2 text-[0.8125rem] text-stone-900 dark:border-stone-500 dark:bg-stone-900 dark:text-stone-100"
);

function Field({ label, children, className }: { label: string; children: ComponentChildren; className?: string }) {
  return (
    <label className={cx("block min-w-0 text-xs", TEXT_MUTED, className)}>
      {label}
      {children}
    </label>
  );
}

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
    <Field label={label}>
      <select
        className={CONTROL}
        onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value || null)}
        value={value ?? ""}
      >
        <option value="">Any</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

function Filters({ filters, repos }: { filters: ItemFilters; repos: string[] }) {
  // The URL is the state. Replacing the entry keeps Back leaving the list in one step.
  function set(patch: Partial<ItemFilters>) {
    navigate(`/items${filtersToSearch({ ...filters, ...patch })}`, { replace: true });
  }
  // A repository named in the URL stays selectable even when no listed item targets it.
  const repoOptions = filters.repo && !repos.includes(filters.repo) ? [...repos, filters.repo] : repos;
  return (
    <div
      aria-label="Filter items"
      className="mt-4 grid grid-cols-2 gap-x-2.5 gap-y-2 md:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]"
      role="search"
    >
      <Field className="col-span-2 md:col-span-1" label="Search title or ref">
        <input
          className={CONTROL}
          onInput={(event) => set({ q: (event.currentTarget as HTMLInputElement).value })}
          placeholder="such as stream or #33420"
          type="search"
          value={filters.q}
        />
      </Field>
      <Select
        label="Stage"
        onChange={(value) => set({ stage: isOneOf(STAGES, value) ? value : null })}
        options={STAGES.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] }))}
        value={filters.stage}
      />
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
      <Select
        label="Repository"
        onChange={(value) => set({ repo: value })}
        options={repoOptions.map((repo) => ({ value: repo, label: repo }))}
        value={filters.repo}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const DASH = <span aria-hidden="true">–</span>;

function None({ label }: { label: string }) {
  return (
    <span className={TEXT_MUTED}>
      {DASH}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function UpstreamRef({ item }: { item: ListItem }) {
  const link = item.primaryLink;
  if (!link) return <None label="No upstream thread" />;
  const state = linkState(link);
  return (
    <>
      <RefLink link={link} />
      <span className={cx("block text-xs", TEXT_MUTED)}>
        {shortKind(link.kind)}
        {state ? ` · ${state.text.toLowerCase()}` : ""}
      </span>
    </>
  );
}

const TH = "px-3 py-2 text-left align-bottom text-xs font-semibold";
const TD = "px-3 py-2 align-top";

function Table({ items }: { items: ListItem[] }) {
  return (
    <table className="w-full border-collapse">
      <caption className="sr-only">Giveback items</caption>
      <thead>
        <tr className="border-b border-stone-300 dark:border-stone-700">
          <th className={TH} scope="col">
            Item
          </th>
          <th className={TH} scope="col">
            Stage
          </th>
          <th className={TH} scope="col">
            Route
          </th>
          <th className={TH} scope="col">
            Waiting on
          </th>
          <th className={TH} scope="col">
            Upstream ref
          </th>
          <th className={TH} scope="col">
            Outcome
          </th>
          <th className={cx(TH, "text-right")} scope="col">
            Age
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-stone-200 dark:divide-stone-800">
        {items.map((item) => (
          <tr key={item.id}>
            <th className={cx(TD, "w-[32%] text-left font-normal")} scope="row">
              <ItemTitleLink item={item} />
              {item.isPublic === false ? (
                <span className="mt-1 block">
                  <NotPublicChip />
                </span>
              ) : null}
            </th>
            <td className={TD}>{STAGE_LABELS[item.stage]}</td>
            <td className={TD}>{item.route ? ROUTE_LABELS[item.route] : <None label="No route yet" />}</td>
            <td className={TD}>
              {item.waitingOn === "jackson" ? (
                <WaitingChip waitingOn="jackson" />
              ) : item.waitingOn === "nobody" ? (
                <None label="Nobody" />
              ) : (
                WAITING_ON_LABELS[item.waitingOn]
              )}
            </td>
            <td className={TD}>
              <UpstreamRef item={item} />
            </td>
            <td className={TD}>{item.outcome ? OUTCOME_LABELS[item.outcome] : <None label="No outcome" />}</td>
            <td className={cx(TD, "text-right text-xs")}>
              <Age at={item.foundAt} label="Found" />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The same rows for a narrow screen: each item is a short stack, so nothing scrolls sideways. */
function Stack({ items }: { items: ListItem[] }) {
  return (
    <ul className="divide-y divide-stone-200 dark:divide-stone-800">
      {items.map((item) => {
        const link = item.primaryLink;
        return (
          <li className="px-3.5 py-2.5" key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0">
                <ItemTitleLink item={item} />
              </p>
              <Age at={item.foundAt} className="pt-0.5 text-xs" label="Found" />
            </div>
            <ChipList className="mt-1.5">
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
              ) : item.waitingOn !== "nobody" ? (
                <li>
                  <WaitingChip waitingOn={item.waitingOn} />
                </li>
              ) : null}
            </ChipList>
            {item.route || link ? (
              <p className={cx("mt-1.5 text-xs", TEXT_MUTED)}>
                {item.route ? ROUTE_LABELS[item.route] : null}
                {item.route && link ? " · " : null}
                {link ? (
                  <>
                    <RefLink link={link} /> {shortKind(link.kind)}
                    {linkState(link) ? ` · ${linkState(link)?.text.toLowerCase()}` : ""}
                  </>
                ) : null}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function ItemsBody({ items }: { items: ListItem[] | undefined }) {
  const { search } = useLocation();
  const filters = parseFilters(search);
  if (items === undefined) {
    return <Skeleton label="Loading the items" rows={8} />;
  }
  if (items.length === 0) {
    return (
      <Box className="mt-6">
        <p className={cx("px-3.5 py-4", TEXT_MUTED)}>No items have been recorded yet.</p>
      </Box>
    );
  }
  const shown = sortForList(applyFilters(items, filters));
  const filtered = hasFilters(filters);
  return (
    <>
      <Filters filters={filters} repos={repositories(items)} />
      <p aria-live="polite" className={cx("mt-4 text-xs", TEXT_MUTED)}>
        {filtered ? `Showing ${shown.length} of ${items.length} items.` : `${items.length} items, in pipeline order.`}{" "}
        {filtered ? (
          <Link className={LINK} replace to="/items">
            Clear filters
          </Link>
        ) : null}
      </p>
      <Box className="mt-2">
        {shown.length === 0 ? (
          <p className={cx("px-3.5 py-4", TEXT_MUTED)}>No items match these filters.</p>
        ) : (
          <>
            <div className="hidden md:block">
              <Table items={shown} />
            </div>
            <div className="md:hidden">
              <Stack items={shown} />
            </div>
          </>
        )}
      </Box>
      <p className={cx("mt-2 text-xs", TEXT_MUTED)}>Age counts from when the item was found.</p>
    </>
  );
}

function PublicItems() {
  return <ItemsBody items={client.useQuery("items")} />;
}

function OwnerItems() {
  return <ItemsBody items={client.useQuery("ownerItems")} />;
}

export function ItemsPage() {
  useTitle("All items");
  const viewer = useViewer();
  return (
    <>
      <h1 className="mt-6 text-xl font-semibold tracking-tight">All items</h1>
      <p className={cx("mt-1 max-w-2xl", TEXT_MUTED)}>
        Every fix that has been considered for upstream, whatever became of it.
      </p>
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
