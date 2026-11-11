// Formatting helpers. Pure: no DOM, no Lakebed. Dates use the viewer's locale
// through Intl, which exists in every runtime these run in.

import type { LinkKind } from "../../shared/enums";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
/** Mean Gregorian month and year. Ages past ten weeks are approximate by nature. */
export const MONTH = 30.4375 * DAY;
export const YEAR = 365.25 * DAY;

/**
 * A length of time as a short natural reading: "<1 min", "12 min", "5 h", "11 d", "3 wk", "4 mo", "2 yr".
 * Always rounds down, so "11 d" means at least eleven whole days. A negative span reads as "<1 min".
 */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < MINUTE) return "<1 min";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  if (ms < 2 * WEEK) return `${Math.floor(ms / DAY)} d`;
  if (ms < 10 * WEEK) return `${Math.floor(ms / WEEK)} wk`;
  if (ms < 2 * YEAR) return `${Math.floor(ms / MONTH)} mo`;
  return `${Math.floor(ms / YEAR)} yr`;
}

/** The time from `at` until `now`, as `formatSpan` reads it. */
export function formatAge(at: number, now: number): string {
  return formatSpan(now - at);
}

/** "9 d ago", or "just now" under a minute. */
export function formatAgo(at: number, now: number): string {
  return now - at < MINUTE ? "just now" : `${formatSpan(now - at)} ago`;
}

/** A calendar date in the viewer's locale, such as "7 Nov 2026". */
export function formatDate(at: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone }).format(at);
}

/** The exact moment in the viewer's locale, for `title` attributes. */
export function formatDateTime(at: number, locale?: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(at);
}

/** An ISO 8601 string for `<time dateTime>`, or an empty string when the value is not a real time. */
export function isoTime(at: number): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

/** "pingdotgg/t3code" and 33420 → "t3code#33420". */
export function shortRef(repo: string, number: number): string {
  const name = repo.includes("/") ? repo.slice(repo.lastIndexOf("/") + 1) : repo;
  return `${name}#${number}`;
}

/** "pingdotgg/t3code" and 33420 → "pingdotgg/t3code#33420". */
export function fullRef(repo: string, number: number): string {
  return `${repo}#${number}`;
}

const SHORT_KIND: Record<LinkKind, string> = {
  pr: "PR",
  issue: "Issue",
  comment: "Comment",
  discussion: "Discussion"
};

export function shortKind(kind: LinkKind): string {
  return SHORT_KIND[kind];
}

/** A commit SHA cut to the usual twelve characters. */
export function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

/**
 * The GitHub page of a J5 origin ref written as "owner/name#123", or null when
 * the ref is free text. GitHub redirects /issues/N to the pull request when N is one.
 */
export function originRefUrl(ref: string): string | null {
  const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+)#(\d+)$/.exec(ref.trim());
  return match ? `https://github.com/${match[1]}/issues/${match[2]}` : null;
}

/** "1 item", "3 items". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
