// Checks for the pure helpers in this folder. Not part of the app: nothing imports
// this file, so Lakebed does not bundle it. It has no test runner to install. Run:
//
//   npx esbuild client/lib/lib.check.ts --bundle --format=esm | node --input-type=module
//
// It prints one line per group and throws on the first failure.

import type { ItemView, LinkView, SyncView } from "../../shared/api";
import { MAIN_PATH_STAGES, STAGES, STAGE_DESCRIPTIONS, STAGE_LABELS } from "../../shared/enums";
import {
  candidates,
  dependencyLinks,
  heldItems,
  median,
  medianTimeToMerge,
  offeredQuietestFirst,
  openAsksByItem,
  ourMove,
  quietState,
  recentlyClosed,
  sortForList,
  syncStatus,
  type ListAsk,
  type ListItem
} from "./derive";
import { applyFilters, filtersToSearch, itemsHref, parseFilters } from "./filters";
import { DAY, HOUR, MINUTE, WEEK, YEAR, formatAgo, formatSpan, originRefUrl, shortRef } from "./format";

function equal(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);

function link(patch: Partial<LinkView> = {}): LinkView {
  return {
    id: "link",
    repo: "pingdotgg/t3code",
    number: 33420,
    url: "https://github.com/pingdotgg/t3code/pull/33420",
    kind: "pr",
    ownership: "ours",
    role: "primary",
    title: null,
    state: "open",
    createdAt: null,
    isDraft: false,
    mergedAt: null,
    closedAt: null,
    ci: null,
    reviewDecision: null,
    labels: [],
    headSha: null,
    macroscopeVerdict: null,
    lastActivityAt: null,
    lastOtherActivityAt: null,
    lastOtherActivityBy: null,
    triageBucket: null,
    triageRank: null,
    syncedAt: null,
    syncError: null,
    ...patch
  };
}

function item(id: string, patch: Partial<ItemView> = {}): ListItem {
  return {
    id,
    disclosed: true,
    slug: id,
    title: `Item ${id}`,
    stage: "offered",
    waitingOn: "maintainer",
    waitingSince: NOW - 5 * DAY,
    foundAt: NOW - 20 * DAY,
    updatedAt: NOW - DAY,
    summary: "",
    route: null,
    routeReason: null,
    outcome: null,
    closedAt: null,
    targetRepo: "pingdotgg/t3code",
    originRefs: [],
    lastValidatedAt: null,
    lastValidatedSha: null,
    validationVerdict: null,
    followUpState: "none",
    followUpNote: null,
    upstreamChangedAt: null,
    upstreamChangeNote: null,
    primaryLink: null,
    dependencyLinks: [],
    ...patch
  };
}

const ids = (items: { id: string }[]) => items.map((entry) => entry.id);

// --- Ages -------------------------------------------------------------------

equal(formatSpan(0), "<1 min", "zero span");
equal(formatSpan(-5 * HOUR), "<1 min", "negative span");
equal(formatSpan(MINUTE - 1), "<1 min", "just under a minute");
equal(formatSpan(MINUTE), "1 min", "one minute");
equal(formatSpan(HOUR - 1), "59 min", "just under an hour");
equal(formatSpan(5 * HOUR + 59 * MINUTE), "5 h", "hours round down");
equal(formatSpan(DAY), "1 d", "one day");
equal(formatSpan(11 * DAY + 23 * HOUR), "11 d", "days round down");
equal(formatSpan(2 * WEEK - 1), "13 d", "just under two weeks");
equal(formatSpan(2 * WEEK), "2 wk", "two weeks");
equal(formatSpan(3 * WEEK + 6 * DAY), "3 wk", "weeks round down");
equal(formatSpan(10 * WEEK - 1), "9 wk", "just under ten weeks");
equal(formatSpan(10 * WEEK), "2 mo", "ten weeks");
equal(formatSpan(2 * YEAR + DAY), "2 yr", "two years");
equal(formatAgo(NOW - 30_000, NOW), "just now", "under a minute ago");
equal(formatAgo(NOW - 4 * MINUTE, NOW), "4 min ago", "minutes ago");
equal(shortRef("pingdotgg/t3code", 33420), "t3code#33420", "short ref");
equal(originRefUrl("Jacksondr5/j5code#2810"), "https://github.com/Jacksondr5/j5code/issues/2810", "origin ref");
equal(originRefUrl("a note, not a ref"), null, "free-text origin");
console.log("ok  ages and refs");

// --- Median and time to merge --------------------------------------------------

equal(median([]), null, "median of nothing");
equal(median([3]), 3, "median of one");
equal(median([5, 1, 3]), 3, "odd median");
equal(median([4, 1, 3, 2]), 2.5, "even median");
const merged = [
  // No PR open date: left out.
  item("a", { stage: "closed", outcome: "merged", foundAt: NOW - 10 * DAY, closedAt: NOW - 2 * DAY }),
  // Opened 10 days ago, merged 6 days ago. GitHub's merge time wins over the item's close time.
  item("b", {
    stage: "closed",
    outcome: "merged",
    closedAt: NOW - DAY,
    primaryLink: link({ state: "merged", createdAt: NOW - 10 * DAY, mergedAt: NOW - 6 * DAY })
  }),
  // Opened 9 days ago, merged 1 day ago.
  item("b2", {
    stage: "closed",
    outcome: "merged",
    primaryLink: link({ state: "merged", createdAt: NOW - 9 * DAY, mergedAt: NOW - DAY })
  }),
  // Merged before it was opened: the dates cannot both be right, so it is left out.
  item("c", {
    stage: "closed",
    outcome: "merged",
    primaryLink: link({ state: "merged", createdAt: NOW - DAY, mergedAt: NOW - 3 * DAY })
  }),
  // The primary link is an issue, so there is no PR to time.
  item("c2", {
    stage: "closed",
    outcome: "merged",
    primaryLink: link({ kind: "issue", createdAt: NOW - 9 * DAY, mergedAt: NOW - DAY })
  }),
  item("d", { stage: "closed", outcome: "dropped", foundAt: NOW - 30 * DAY, closedAt: NOW - DAY }),
  item("e", { stage: "offered" })
];
equal(medianTimeToMerge(merged), { medianMs: 6 * DAY, count: 2 }, "median time to merge");
equal(medianTimeToMerge([item("e")]), { medianMs: null, count: 0 }, "no merged items");
console.log("ok  statistics");

// --- Offered: quietest first ------------------------------------------------------

const offered = [
  item("recent", { primaryLink: link({ lastOtherActivityAt: NOW - HOUR, lastOtherActivityBy: "someone" }) }),
  item("silent", { waitingSince: NOW - 9 * DAY }),
  item("quiet", { primaryLink: link({ lastOtherActivityAt: NOW - 4 * DAY }) }),
  item("closed", { stage: "closed", outcome: "merged" }),
  item("candidate", { stage: "deciding" })
];
equal(ids(offeredQuietestFirst(offered)), ["silent", "quiet", "recent"], "quietest first");
equal(
  quietState(offered[1] as ListItem),
  { since: NOW - 9 * DAY, synced: false, replied: false, by: null },
  "no primary link: upstream activity unknown"
);
equal(
  quietState(item("unsynced", { waitingSince: NOW - 2 * DAY, primaryLink: link() })),
  { since: NOW - 2 * DAY, synced: false, replied: false, by: null },
  "never synced: upstream activity unknown"
);
equal(
  quietState(item("noreply", { waitingSince: NOW - 2 * DAY, primaryLink: link({ syncedAt: NOW }) })),
  { since: NOW - 2 * DAY, synced: true, replied: false, by: null },
  "synced with no reply"
);
equal(quietState(offered[0] as ListItem).replied, true, "replied");
console.log("ok  quietest-first sort");

// --- Candidates, closed, our move, list order ---------------------------------------

const mixed = [
  item("found", { stage: "found", waitingOn: "giveback_agent", foundAt: NOW - DAY, waitingSince: NOW - DAY }),
  item("deciding-new", { stage: "deciding", waitingOn: "jackson", foundAt: NOW - 2 * DAY }),
  item("deciding-old", { stage: "deciding", waitingOn: "jackson", foundAt: NOW - 9 * DAY }),
  item("validating", { stage: "validating", waitingOn: "giveback_agent", waitingSince: NOW - 3 * DAY }),
  item("changed", { stage: "offered", upstreamChangedAt: NOW - HOUR }),
  item("closed-old", { stage: "closed", outcome: "merged", closedAt: NOW - 9 * DAY }),
  item("closed-new", { stage: "closed", outcome: "dropped", closedAt: NOW - DAY }),
  // An undisclosed closed item hides its close date; its last update stands in.
  item("closed-hidden", { stage: "closed", disclosed: false, slug: null, closedAt: null, updatedAt: NOW - 4 * DAY }),
  item("closed-agent", { stage: "closed", outcome: "parked", waitingOn: "giveback_agent", closedAt: NOW - 20 * DAY }),
  item("held-new", { stage: "held", waitingOn: "base_pr", waitingSince: NOW - 2 * DAY, foundAt: NOW - 30 * DAY }),
  item("held-old", { stage: "held", waitingOn: "covering_pr", waitingSince: NOW - 6 * DAY, foundAt: NOW - 8 * DAY }),
  // The covering PR merged: the refresh raised the marker, and the next step is ours.
  item("held-changed", { stage: "held", waitingOn: "covering_pr", waitingSince: NOW - 4 * DAY, upstreamChangedAt: NOW - 2 * HOUR })
];
// A held item is not a candidate: it does not wait on a check or on a decision.
equal(ids(candidates(mixed)), ["deciding-old", "deciding-new", "validating", "found"], "candidates");
equal(ids(heldItems(mixed)), ["held-old", "held-changed", "held-new"], "held, longest-waiting first");
equal(ids(heldItems([item("a", { stage: "deciding" }), item("b", { stage: "closed", outcome: "parked" })])), [], "nothing held");
equal(ids(recentlyClosed(mixed, 3)), ["closed-new", "closed-hidden", "closed-old"], "recently closed");
equal(
  ourMove(mixed).map((move) => `${move.item.id}:${move.reason}`),
  ["held-changed:upstream_changed", "changed:upstream_changed", "validating:agent", "found:agent"],
  "our move"
);
equal(
  ids(sortForList(mixed)),
  [
    "found",
    "validating",
    "deciding-old",
    "deciding-new",
    // Within a stage the list runs oldest-found first, whatever the wait.
    "held-new",
    "held-changed",
    "held-old",
    "changed",
    "closed-new",
    "closed-hidden",
    "closed-old",
    "closed-agent"
  ],
  "list order: held follows deciding"
);
console.log("ok  candidates, held, closed, our move, list order");

// --- The held stage ----------------------------------------------------------------------

equal(STAGES.indexOf("held"), STAGES.indexOf("deciding") + 1, "held is listed after deciding");
equal(MAIN_PATH_STAGES.includes("held"), false, "held is not on the main path");
equal(MAIN_PATH_STAGES.length, STAGES.length - 1, "the main path is every other stage");
equal(MAIN_PATH_STAGES, ["found", "validating", "deciding", "preparing", "approving", "offered", "closed"], "main path order");
equal(STAGE_LABELS.held, "Held", "held label");
equal(STAGES.every((stage) => STAGE_LABELS[stage].length > 0 && STAGE_DESCRIPTIONS[stage].length > 0), true, "every stage has words");
equal(
  dependencyLinks([
    link({ id: "r", role: "related", number: 3 }),
    link({ id: "c", role: "covering", number: 2 }),
    link({ id: "b", role: "base", number: 9 }),
    link({ id: "p", role: "primary", number: 1 })
  ]).map((entry) => entry.id),
  ["b", "c"],
  "a held row shows its base and covering links only"
);
console.log("ok  held stage");

// --- Asks ------------------------------------------------------------------------------

function ask(id: string, itemId: string, openedAt: number, closedAt: number | null = null): ListAsk {
  return {
    id,
    kind: "route_decision",
    label: null,
    openedAt,
    closedAt,
    resolution: null,
    item: { id: itemId, disclosed: true, slug: itemId, title: itemId, stage: "offered" }
  };
}
const byItem = openAsksByItem([ask("2", "x", NOW - DAY), ask("1", "x", NOW - 2 * DAY), ask("3", "y", NOW), ask("4", "y", NOW, NOW)]);
equal(ids(byItem.get("x") ?? []), ["1", "2"], "open asks of an item, oldest first");
equal(ids(byItem.get("y") ?? []), ["3"], "a closed ask is left out");
console.log("ok  asks");

// --- Sync state ---------------------------------------------------------------------------

const sync = (patch: Partial<SyncView>): SyncView => ({
  lastGithubSyncAt: null,
  lastGithubOkAt: null,
  lastAgentPushAt: null,
  lastError: null,
  lastErrorAt: null,
  ...patch
});
equal(syncStatus(sync({}), NOW).kind, "never", "never synced");
equal(syncStatus(sync({ lastGithubSyncAt: NOW - HOUR, lastGithubOkAt: NOW - HOUR }), NOW).kind, "ok", "exactly an hour is not stale");
equal(syncStatus(sync({ lastGithubSyncAt: NOW - 61 * MINUTE, lastGithubOkAt: NOW - 61 * MINUTE }), NOW).kind, "stale", "over an hour");
equal(
  syncStatus(sync({ lastGithubSyncAt: NOW, lastGithubOkAt: NOW - 3 * HOUR, lastError: "boom", lastErrorAt: NOW }), NOW),
  { kind: "failed", failedAt: NOW, lastOkAt: NOW - 3 * HOUR, error: "boom" },
  "a failure wins over staleness"
);
console.log("ok  sync state");

// --- Filters ---------------------------------------------------------------------------------

const parsed = parseFilters("?stage=offered&waiting=jackson&outcome=merged&repo=expo%2Fexpo-device-hub&q=stream+closes");
equal(parsed, { stage: "offered", waiting: "jackson", outcome: "merged", repo: "expo/expo-device-hub", q: "stream closes" }, "parse");
equal(parseFilters(filtersToSearch(parsed)), parsed, "round trip");
equal(parseFilters("?stage=bogus&waiting=&outcome=nope"), { stage: null, waiting: null, outcome: null, repo: null, q: "" }, "unknown values");
equal(itemsHref({ stage: "deciding" }), "/items?stage=deciding", "stage link");
equal(itemsHref({ stage: "held" }), "/items?stage=held", "held stage link");
equal(parseFilters("?stage=held").stage, "held", "held is a stage filter");
equal(itemsHref(), "/items", "no filters");
const list = [
  item("stream", { title: "A revoked session's preview stream closes", primaryLink: link({ number: 32245 }) }),
  item("stop", { title: "An agent's Stop", primaryLink: link({ number: 33420 }) }),
  item("expo", { targetRepo: "expo/expo-device-hub", stage: "closed", outcome: "merged", waitingOn: "nobody" }),
  item("hidden", { disclosed: false, slug: null, title: "Undisclosed candidate", targetRepo: null, stage: "deciding", waitingOn: "jackson" }),
  item("parked", { title: "Waits for a covering PR", stage: "held", waitingOn: "covering_pr" })
];
const run = (search: string) => ids(applyFilters(list, parseFilters(search)));
equal(run(""), ["stream", "stop", "expo", "hidden", "parked"], "no filter");
equal(run("?stage=held"), ["parked"], "held stage");
equal(run("?q=STREAM+closes"), ["stream"], "every word, any case");
equal(run("?q=%2333420"), ["stop"], "bare number");
equal(run("?q=t3code%2333420"), ["stop"], "short ref");
equal(run("?q=pingdotgg/t3code%2332245"), ["stream"], "full ref");
equal(run("?stage=deciding"), ["hidden"], "stage");
equal(run("?waiting=jackson"), ["hidden"], "waiting on");
equal(run("?outcome=merged"), ["expo"], "outcome");
equal(run("?repo=expo/expo-device-hub"), ["expo"], "repository");
equal(run("?stage=offered&q=stop"), ["stop"], "combined");
equal(run("?q=nothing-matches"), [], "no match");
console.log("ok  filters");

console.log("all checks passed");
