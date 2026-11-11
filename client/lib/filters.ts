// The item list's filters, and their form in the URL query string.
// Pure: takes and returns strings, so links and reloads restore the same view.

import {
  OUTCOMES,
  STAGES,
  WAITING_ON,
  isOneOf,
  type Outcome,
  type Stage,
  type WaitingOn
} from "../../shared/enums";
import { parseItemId } from "../../shared/itemId";
import type { ListItem } from "./derive";
import { fullRef, shortRef } from "./format";

export type ItemFilters = {
  stage: Stage | null;
  waiting: WaitingOn | null;
  outcome: Outcome | null;
  repo: string | null;
  /** Free text, matched against the item's ID, title, slug and upstream ref. */
  q: string;
};

export const NO_FILTERS: ItemFilters = { stage: null, waiting: null, outcome: null, repo: null, q: "" };

const MAX_QUERY_LENGTH = 100;

/** Reads filters from a location's `search`. An unknown value for a filter is ignored, not an error. */
export function parseFilters(search: string): ItemFilters {
  const params = new URLSearchParams(search);
  const stage = params.get("stage");
  const waiting = params.get("waiting");
  const outcome = params.get("outcome");
  const repo = params.get("repo");
  return {
    stage: isOneOf(STAGES, stage) ? stage : null,
    waiting: isOneOf(WAITING_ON, waiting) ? waiting : null,
    outcome: isOneOf(OUTCOMES, outcome) ? outcome : null,
    repo: repo && repo.length <= 100 ? repo : null,
    q: (params.get("q") ?? "").slice(0, MAX_QUERY_LENGTH)
  };
}

/** The query string for the filters, with a leading "?", or "" when none is set. */
export function filtersToSearch(filters: ItemFilters): string {
  const params = new URLSearchParams();
  if (filters.stage) params.set("stage", filters.stage);
  if (filters.waiting) params.set("waiting", filters.waiting);
  if (filters.outcome) params.set("outcome", filters.outcome);
  if (filters.repo) params.set("repo", filters.repo);
  if (filters.q.trim()) params.set("q", filters.q);
  const text = params.toString();
  return text ? `?${text}` : "";
}

/** The item list's address with these filters set. */
export function itemsHref(filters: Partial<ItemFilters> = {}): string {
  return `/items${filtersToSearch({ ...NO_FILTERS, ...filters })}`;
}

export function hasFilters(filters: ItemFilters): boolean {
  return filtersToSearch(filters) !== "";
}

/** The text a search runs over: title, slug, and the upstream ref in its short, full and bare-number forms. */
export function searchText(item: ListItem): string {
  const parts = [item.title, item.slug ?? ""];
  const link = item.primaryLink;
  if (link) {
    parts.push(shortRef(link.repo, link.number), fullRef(link.repo, link.number), `#${link.number}`);
  }
  return parts.join(" ").toLowerCase();
}

/**
 * The item number a search word asks for, or null when the word is not an ID.
 * "GB-12" in either case is one. A bare "12" is one only when it is the whole
 * search, so a number inside a longer search stays what it was: text.
 */
export function searchedNumber(word: string, wholeQuery: boolean): number | null {
  const byId = parseItemId(word);
  if (byId !== null) return byId;
  return wholeQuery && /^[1-9][0-9]{0,6}$/.test(word) ? Number(word) : null;
}

/**
 * True when the item passes every set filter. Every word of the search must
 * appear in the item's text, or be its ID. An ID matches whole: "GB-1" finds
 * GB-1 and not GB-12.
 */
export function matchesFilters(item: ListItem, filters: ItemFilters): boolean {
  if (filters.stage && item.stage !== filters.stage) return false;
  if (filters.waiting && item.waitingOn !== filters.waiting) return false;
  if (filters.outcome && item.outcome !== filters.outcome) return false;
  if (filters.repo && item.targetRepo !== filters.repo) return false;
  const words = filters.q.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const text = searchText(item);
  return words.every((word) => {
    // A word written as an ID is only ever an ID: "GB-1" must not find "GB-12" in some item's text.
    const id = parseItemId(word);
    if (id !== null) return item.number === id;
    const number = searchedNumber(word, words.length === 1);
    return (number !== null && item.number === number) || text.includes(word);
  });
}

export function applyFilters(items: readonly ListItem[], filters: ItemFilters): ListItem[] {
  return items.filter((item) => matchesFilters(item, filters));
}
