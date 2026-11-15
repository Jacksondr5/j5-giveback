// Checks for the pure helpers in this folder. Not part of the app: nothing imports
// this file, so Lakebed does not bundle it. It has no test runner to install. Run:
//
//   npx esbuild client/lib/lib.check.ts --bundle --format=esm | node --input-type=module
//
// It prints one line per group and throws on the first failure.

import type { ItemView, LinkView, SyncView } from "../../shared/api";
import {
  CHANGE_KINDS,
  CHANGE_KIND_DESCRIPTIONS,
  CHANGE_KIND_LABELS,
  MAIN_PATH_STAGES,
  STAGES,
  STAGE_DESCRIPTIONS,
  STAGE_LABELS,
  WAITING_ON,
  WAITING_ON_LABELS
} from "../../shared/enums";
import {
  POST_WEEKS,
  RULES_REPOS,
  closingClock,
  countNewThreads,
  countPosts,
  postStarts,
  fillsSlot,
  nextSweepAt,
  postsWindowStart,
  queueOrder,
  rulesFor,
  sweepTimeUtc,
  textApproval,
  weekStartUtc
} from "../../shared/upstreamRules";
import {
  candidates,
  dependencyLinks,
  heldItems,
  median,
  medianTimeToMerge,
  offeredAndClosed,
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
import { ITEM_ID_PREFIX, formatItemId, isItemNumber, itemIdOf, parseItemId } from "../../shared/itemId";
import { applyFilters, filtersToSearch, hasFilters, itemsHref, parseFilters, searchedNumber } from "./filters";
import { DAY, HOUR, MINUTE, WEEK, YEAR, formatAgo, formatCountdown, formatDayMonth, formatSpan, originRefUrl, shortRef } from "./format";
import {
  askAction,
  ciSignal,
  clockWords,
  commentHost,
  groupByStage,
  hasThreadSignals,
  itemPath,
  listThreads,
  macroscopeSignal,
  outcomeMark,
  roleWord,
  slotWords,
  stageCounts,
  textApprovalWords,
  threadName,
  threadSide,
  threadState
} from "./present";

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
    closingNoticeAt: null,
    mergeable: null,
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
    number: null,
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
    changeKind: null,
    queueRank: null,
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
equal(
  offeredAndClosed([
    item("m", { stage: "closed", outcome: "merged", primaryLink: link({ state: "merged" }) }),
    item("t", { stage: "closed", outcome: "fixed_upstream", primaryLink: link({ ownership: "theirs" }) }),
    item("n", { stage: "closed", outcome: "dropped" }),
    item("o", { stage: "offered", primaryLink: link() })
  ]),
  1,
  "closed after an offer: only closed items with a thread of ours"
);
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
    item: { id: itemId, number: null, disclosed: true, slug: itemId, title: itemId, stage: "offered" }
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
equal(
  parsed,
  { stage: "offered", waiting: "jackson", outcome: "merged", kind: null, repo: "expo/expo-device-hub", q: "stream closes", all: false },
  "parse"
);
equal(parseFilters(filtersToSearch(parsed)), parsed, "round trip");
equal(
  parseFilters("?stage=bogus&waiting=&outcome=nope"),
  { stage: null, waiting: null, outcome: null, kind: null, repo: null, q: "", all: false },
  "unknown values"
);
equal(itemsHref({ stage: "deciding" }), "/items?stage=deciding", "stage link");
equal(itemsHref({ stage: "held" }), "/items?stage=held", "held stage link");
equal(parseFilters("?stage=held").stage, "held", "held is a stage filter");
equal(itemsHref(), "/items", "no filters");
const list = [
  item("stream", { title: "A revoked session's preview stream closes", primaryLink: link({ number: 32245 }) }),
  item("stop", { title: "An agent's Stop", primaryLink: link({ number: 33420 }) }),
  item("expo", {
    targetRepo: "expo/expo-device-hub",
    stage: "closed",
    outcome: "merged",
    waitingOn: "nobody",
    primaryLink: link({ repo: "expo/expo-device-hub", number: 464, state: "merged" })
  }),
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

// Item IDs. The prefix is read from the shared module, so these hold for any prefix.
const ID12 = formatItemId(12);
equal(ID12, `${ITEM_ID_PREFIX}-12`, "format");
equal(parseItemId(ID12), 12, "parse");
equal(parseItemId(ID12.toLowerCase()), 12, "parse, lower case");
equal(parseItemId(` ${ID12} `), 12, "parse, spaces around");
equal(parseItemId(formatItemId(350)), 350, "format and parse round trip");
equal(
  [`${ITEM_ID_PREFIX}-0`, `${ITEM_ID_PREFIX}-012`, `${ITEM_ID_PREFIX}12`, "12", `${ID12}a`, `x${ID12}`, `${ITEM_ID_PREFIX}-1.5`, `${ITEM_ID_PREFIX}--1`, `${ITEM_ID_PREFIX}-12345678`, ""].map(parseItemId),
  [null, null, null, null, null, null, null, null, null, null],
  "not an ID"
);
equal([0, 1, 1.5, -3, 350].map(isItemNumber), [false, true, false, false, true], "a number an item can have");
equal([itemIdOf({ number: 3 }), itemIdOf({ number: null }), itemIdOf({})], [formatItemId(3), null, null], "the ID of an item");
equal(searchedNumber(ID12.toLowerCase(), false), 12, "an ID is a number anywhere in a search");
equal([searchedNumber("12", true), searchedNumber("12", false), searchedNumber("012", true)], [12, null, null], "a bare number only as the whole search");

const numbered = [
  item("one", { number: 1 }),
  item("twelve", { number: 12, primaryLink: link({ number: 4100 }) }),
  item("one-twenty", { number: 120 }),
  item("withheld", { number: 7, disclosed: false, slug: null, title: "Undisclosed candidate", targetRepo: null }),
  item("pr-twelve", { primaryLink: link({ number: 12 }) }),
  item("no-number"),
  // Its title holds another item's ID as text. A search for a shorter ID must not find it.
  item("mentions-twelve", { number: 30, title: `Follow ${formatItemId(12)}` })
];
const find = (q: string) => ids(applyFilters(numbered, parseFilters(`?q=${encodeURIComponent(q)}`)));
equal(find(ID12), ["twelve"], "search by ID");
equal(find(ID12.toLowerCase()), ["twelve"], "search by ID, lower case");
equal(find(formatItemId(1)), ["one"], "an ID matches whole, not as a prefix");
equal(find(ID12), ["twelve"], "an ID does not match text that mentions it");
equal(find(formatItemId(7)), ["withheld"], "an undisclosed item is found by its ID");
equal(find(formatItemId(999)), [], "an ID no item has");
equal(find(`${ID12} twelve`), ["twelve"], "an ID beside another word");
equal(find(`${ID12} one`), [], "an ID and a word of another item");
equal(
  find("12"),
  ["twelve", "pr-twelve", "mentions-twelve"],
  "a bare number alone: the item with that number, and text that holds it"
);
equal(find("12 item"), ["pr-twelve"], "a bare number beside another word is text only");

// Candidates closed without an offer are left out of the list unless asked for.
const offerMix = [
  item("live", { stage: "offered", primaryLink: link() }),
  item("merged-ours", { stage: "closed", outcome: "merged", primaryLink: link({ state: "merged" }) }),
  item("dropped-bare", { stage: "closed", outcome: "dropped", title: "Dropped candidate" }),
  item("fixed-theirs", { stage: "closed", outcome: "fixed_upstream", primaryLink: link({ ownership: "theirs" }) })
];
const listed = (search: string) => ids(applyFilters(offerMix, parseFilters(search)));
equal(listed(""), ["live", "merged-ours"], "by default, closed without an offer is left out");
equal(listed("?all=1"), ["live", "merged-ours", "dropped-bare", "fixed-theirs"], "show all brings them back");
equal(listed("?stage=closed"), ["merged-ours", "dropped-bare", "fixed-theirs"], "the Closed stage shows every closed item");
equal(listed("?outcome=dropped"), ["dropped-bare"], "an outcome filter finds them");
equal(listed("?q=dropped"), ["dropped-bare"], "a search finds them");
equal(listed("?stage=offered"), ["live"], "another stage is unaffected");
equal(hasFilters(parseFilters("?all=1")), false, "show all is not a narrowing filter");
equal(filtersToSearch(parseFilters("?all=1&stage=held")), "?stage=held&all=1", "show all survives in the address");

// Where an item's page is: its ID, or until it has a number its slug, or its row id when it has neither.
equal(itemPath({ id: "row-1", slug: "some-fix", number: 4 }), `/items/${formatItemId(4)}`, "a numbered item links by ID");
equal(itemPath({ id: "row-1", slug: "some-fix", number: null }), "/items/some-fix", "an item with no number yet links by slug");
equal(itemPath({ id: "row-2", slug: null, number: 7 }), `/items/${formatItemId(7)}`, "an undisclosed item links by ID");
equal(itemPath({ id: "row-3", slug: null, number: null }), "/items/row-3", "an undisclosed item with no number links by row id");
equal(itemPath({ id: "row-4", slug: null }), "/items/row-4", "a reference with no number field");
console.log("ok  filters");

// --- Presentation -------------------------------------------------------------

// The action an ask needs: one instruction. A label that is itself an instruction is the action;
// a label that states a fact follows the kind of action as context.
equal(askAction("route_decision", "Decide which of the two fixes to offer"), { action: "Decide which of the two fixes to offer", detail: null }, "instruction label is the action");
equal(askAction("route_decision", "Choose a route: direct PR or issue first"), { action: "Choose a route: direct PR or issue first", detail: null }, "instruction label with a colon");
equal(askAction("text_approval", "Approve the issue text"), { action: "Approve the issue text", detail: null }, "same verb, label wins");
equal(askAction("side_choice", "Rebase onto main or keep the stack"), { action: "Rebase onto main or keep the stack", detail: null }, "another instruction verb");
equal(askAction("bot_ci_findings", "Two review-bot findings need a decision"), { action: "Decide on bot or CI findings", detail: "Two review-bot findings need a decision" }, "a fact follows the kind of action");
equal(askAction("device_needed", "Needs a check on a physical iPhone"), { action: "Test on a device", detail: "Needs a check on a physical iPhone" }, "a fact, not an instruction");
equal(askAction("maintainer_question", "A maintainer asked whether delegated stops should name the parent"), { action: "Answer a maintainer", detail: "A maintainer asked whether delegated stops should name the parent" }, "maintainer question");
equal(askAction("device_needed", null), { action: "Test on a device", detail: null }, "undisclosed ask has no label");
equal(askAction("side_choice", "   "), { action: "Choose between options", detail: null }, "blank label");

// Ours or theirs.
equal(threadSide(link()), "ours", "our PR");
equal(threadSide(link({ kind: "comment" })), "our_comment", "our comment");
equal(threadSide(link({ kind: "comment", ownership: "theirs" })), "theirs", "their comment");
equal(threadSide(link({ ownership: "theirs", role: "covering" })), "theirs", "their covering PR");
equal(threadName(link()), "Our PR", "name: our PR");
equal(threadName(link({ kind: "issue", ownership: "theirs" })), "Their issue", "name: their issue");
equal(threadName(link({ kind: "comment" })), "Our comment on their thread", "name: our comment");
equal(threadName(link({ kind: "comment" }), link({ kind: "issue", ownership: "theirs" })), "Our comment on their issue", "name: our comment, host known");
equal(threadName(link({ kind: "comment" }), link({ kind: "pr" })), "Our comment on our PR", "name: our comment on our own thread");
equal(threadName(link({ kind: "discussion" })), "Our discussion", "name: our discussion");
equal(roleWord("primary"), null, "primary has no role word");
equal(roleWord("covering"), "covers this", "covering");
equal(roleWord("base"), "base", "base");

// Live state: icon, tone and words. A PR closed unmerged is the one red state.
equal(threadState(link()), { icon: "prOpen", tone: "open", text: "Open" }, "open PR");
equal(threadState(link({ isDraft: true })), { icon: "prDraft", tone: "draft", text: "Draft" }, "draft PR");
equal(threadState(link({ state: "merged" })), { icon: "merged", tone: "merged", text: "Merged" }, "merged PR");
equal(threadState(link({ state: "closed" })), { icon: "prClosed", tone: "closed", text: "Closed, not merged" }, "closed PR");
equal(threadState(link({ kind: "issue", state: "closed" })), { icon: "issueClosed", tone: "merged", text: "Closed" }, "closed issue is not red");
equal(threadState(link({ kind: "issue" })), { icon: "issueOpen", tone: "open", text: "Open" }, "open issue");
equal(threadState(link({ kind: "discussion" })), { icon: "discussion", tone: "open", text: "Open" }, "open discussion");
equal(threadState(link({ kind: "comment" })), { icon: "comment", tone: "open", text: "Open" }, "comment reports its thread");
equal(threadState(link({ kind: "comment", state: "merged" })).text, "Merged", "comment on a merged thread");
equal(threadState(link({ state: null })), { icon: "prOpen", tone: "dim", text: "Not yet synced" }, "unsynced");
equal(ciSignal("failure").text, "CI failing", "CI failing");
equal(macroscopeSignal("Approved at dccdab7").tone, "open", "macroscope yes");
equal(macroscopeSignal("Not approved").tone, "closed", "macroscope no");
equal(macroscopeSignal("Needs Human Approval").tone, "dim", "macroscope pending");
equal(outcomeMark("merged").icon, "merged", "merged outcome");
equal(outcomeMark("closed_by_upstream").tone, "closed", "closed by upstream");

// The threads beside an item in a list: primary first, then what it depends on, never twice.
const primary = link({ id: "p" });
const covering = link({ id: "c", ownership: "theirs", role: "covering", number: 30593 });
equal(ids(listThreads(item("a", { primaryLink: primary, dependencyLinks: [covering] }))), ["p", "c"], "primary then dependencies");
equal(ids(listThreads(item("b", { primaryLink: primary, dependencyLinks: [primary, covering] }))), ["p", "c"], "primary not repeated");
equal(ids(listThreads(item("c", { dependencyLinks: [covering] }))), ["c"], "no thread of ours");
equal(listThreads(item("d")), [], "no threads");

// Our comment names the thread it is on only when the item lists that thread.
const comment = link({ id: "k", kind: "comment", number: 15993 });
const hostIssue = link({ id: "h", kind: "issue", ownership: "theirs", role: "related", number: 15993 });
equal(commentHost(comment, [comment, hostIssue, covering])?.id, "h", "comment host found");
equal(commentHost(comment, [comment, covering]), null, "comment host not listed");
equal(commentHost(primary, [primary, hostIssue]), null, "a PR has no host");

const staged = [item("o1"), item("o2"), item("d1", { stage: "deciding" }), item("o3")];
equal(groupByStage(staged).map((group) => [group.stage, ids(group.items)]), [["offered", ["o1", "o2"]], ["deciding", ["d1"]], ["offered", ["o3"]]], "consecutive groups");
equal([...stageCounts(staged)], [["offered", 3], ["deciding", 1]], "stage counts");
console.log("ok  presentation");

// --- Upstream rules: slots, closing clocks, the queue, posts per week --------------------------

const T3 = "pingdotgg/t3code";
const rules = rulesFor(T3);
if (!rules) throw new Error("pingdotgg/t3code has no rules");
equal(RULES_REPOS, [T3], "the one repository with rules");
equal([rules.openPrLimit, rules.conflictIdleDays, rules.noticeHours], [3, 7, 72], "limit, idle days, notice hours");
equal([rules.rebaseLabel, rules.closingLabel, rules.keepOpenLabel], ["needs-rebase", "triage:closing", "triage:keep-open"], "label names");
equal(rulesFor("PingDotGG/T3Code") === rules, true, "repository names are not case-sensitive");
equal(rulesFor("expo/expo-device-hub"), null, "a repository outside the map has no rules");
equal(rulesFor(null), null, "no repository, no rules");
equal(sweepTimeUtc(rules), "05:23", "the sweep time");

// A slot is one of our PRs that is open, or not yet read.
equal(fillsSlot({ kind: "pr", ownership: "ours", state: "open" }), true, "our open PR fills a slot");
equal(fillsSlot({ kind: "pr", ownership: "ours", state: null }), true, "our PR not yet synced fills a slot");
equal(fillsSlot({ kind: "pr", ownership: "ours", state: "merged" }), false, "a merged PR frees its slot");
equal(fillsSlot({ kind: "pr", ownership: "ours", state: "closed" }), false, "a closed PR frees its slot");
equal(fillsSlot({ kind: "pr", ownership: "theirs", state: "open" }), false, "their PR is not ours to count");
equal(fillsSlot({ kind: "issue", ownership: "ours", state: "open" }), false, "an issue is not a PR");
equal(fillsSlot({ kind: "comment", ownership: "ours", state: "open" }), false, "a comment is not a PR");

// The clock. NOW is 11 Nov 2026 12:00 UTC.
// Upstream marks an unvouched author's PR, and only such a PR is asked to rebase. Ours carry the mark.
const labelled = (labels: string[], patch: Partial<LinkView> = {}) =>
  link({ labels: [...labels, "vouch:unvouched"], lastActivityAt: NOW - 2 * DAY, ...patch });
equal(closingClock(labelled([]), NOW), null, "no label, no clock");
equal(closingClock(labelled(["size:M"]), NOW), null, "other labels start nothing");
equal(
  closingClock(link({ labels: ["needs-rebase"], lastActivityAt: NOW - 2 * DAY }), NOW),
  null,
  "without the unvouched mark the bot takes the rebase label off, so no clock runs"
);
equal(
  closingClock(labelled(["needs-rebase"], { mergeable: "MERGEABLE" }), NOW),
  null,
  "a PR that merges cleanly is not closed: the label comes off at the next sweep"
);
equal(closingClock(labelled(["needs-rebase"], { mergeable: "CONFLICTING" }), NOW)?.kind, "rebase", "a conflicting PR has the clock");
equal(closingClock(labelled(["needs-rebase"], { mergeable: "UNKNOWN" }), NOW)?.kind, "rebase", "GitHub has not said: the clock is shown");
equal(
  closingClock(link({ labels: ["triage:closing"], closingNoticeAt: NOW - HOUR, lastActivityAt: NOW - HOUR }), NOW)?.kind,
  "notice",
  "a closing notice needs no unvouched mark"
);
equal(
  closingClock(labelled(["needs-rebase"]), NOW),
  { kind: "rebase", closesAt: NOW + 5 * DAY, due: false },
  "a rebase request closes 7 days after the last activity"
);
equal(
  closingClock(labelled(["needs-rebase"], { lastActivityAt: NOW - 7 * DAY }), NOW),
  { kind: "rebase", closesAt: NOW, due: true },
  "it is due at 7 days to the millisecond, as upstream counts it"
);
equal(closingClock(labelled(["needs-rebase"], { lastActivityAt: NOW - 7 * DAY + 1 }), NOW)?.kind === "rebase", true, "one millisecond short");
equal(
  (closingClock(labelled(["needs-rebase"], { lastActivityAt: NOW - 7 * DAY + 1 }), NOW) as { due: boolean }).due,
  false,
  "one millisecond short is not due"
);
equal(closingClock(labelled(["needs-rebase"], { lastActivityAt: null }), NOW), null, "no activity time, nothing to count from");
// Only an open PR of ours in a repository with rules.
equal(closingClock(labelled(["needs-rebase"], { ownership: "theirs" }), NOW), null, "their PR has no clock here");
equal(closingClock(labelled(["needs-rebase"], { state: "closed" }), NOW), null, "a closed PR has no clock");
equal(closingClock(labelled(["needs-rebase"], { state: "merged" }), NOW), null, "a merged PR has no clock");
equal(closingClock(labelled(["needs-rebase"], { state: null }), NOW), null, "an unsynced link has no clock");
equal(closingClock(labelled(["needs-rebase"], { kind: "issue" }), NOW), null, "an issue has no clock");
equal(closingClock(labelled(["needs-rebase"], { repo: "expo/expo-device-hub" }), NOW), null, "no rules, no clock");
// Keep-open stops both.
equal(closingClock(labelled(["needs-rebase", "triage:keep-open"]), NOW), null, "keep-open stops the rebase clock");
equal(
  closingClock(labelled(["triage:closing", "triage:keep-open"], { closingNoticeAt: NOW - DAY, lastActivityAt: NOW - DAY }), NOW),
  null,
  "keep-open stops the notice"
);
// The notice: 72 hours from when the label was applied.
const noticed = (patch: Partial<LinkView> = {}) =>
  labelled(["triage:closing"], { closingNoticeAt: NOW - 31 * HOUR, lastActivityAt: NOW - 31 * HOUR + 2000, ...patch });
equal(closingClock(noticed(), NOW), { kind: "notice", closesAt: NOW + 41 * HOUR, due: false }, "a notice closes 72 hours after it");
equal(
  closingClock(noticed({ lastActivityAt: NOW - 31 * HOUR + 15_000 }), NOW)?.kind,
  "notice",
  "15 seconds after the notice is the notice itself"
);
equal(
  closingClock(noticed({ lastActivityAt: NOW - 31 * HOUR + 15_001 }), NOW),
  { kind: "answered", noticeAt: NOW - 31 * HOUR },
  "activity more than 15 seconds after the notice answers it"
);
equal(closingClock(noticed({ lastActivityAt: null }), NOW)?.kind, "notice", "no activity time is no answer");
equal(
  closingClock(noticed({ closingNoticeAt: NOW - 72 * HOUR, lastActivityAt: NOW - 72 * HOUR }), NOW),
  { kind: "notice", closesAt: NOW, due: true },
  "due at 72 hours"
);
equal(
  closingClock(noticed({ closingNoticeAt: NOW - 100 * HOUR, lastActivityAt: NOW - HOUR }), NOW)?.kind,
  "answered",
  "an answer counts even past the 72 hours: the next sweep lifts the notice"
);
equal(closingClock(noticed({ closingNoticeAt: null }), NOW), { kind: "notice_unknown" }, "a notice whose time was not read");
// The notice outranks the rebase.
equal(
  closingClock(labelled(["needs-rebase", "triage:closing"], { closingNoticeAt: NOW - HOUR, lastActivityAt: NOW - HOUR }), NOW),
  { kind: "notice", closesAt: NOW + 71 * HOUR, due: false },
  "with both labels the notice is the clock"
);
equal(
  closingClock(labelled(["needs-rebase", "triage:closing"], { closingNoticeAt: NOW - 3 * DAY, lastActivityAt: NOW - DAY }), NOW)?.kind,
  "answered",
  "an answered notice still outranks the rebase"
);
equal(
  closingClock(labelled(["needs-rebase", "triage:closing"], { closingNoticeAt: null }), NOW)?.kind,
  "notice_unknown",
  "a notice of unknown time does not fall back to the rebase clock"
);

// The sweep: daily at 05:23 UTC.
equal(nextSweepAt(rules, Date.UTC(2026, 10, 11, 5, 22, 59)), Date.UTC(2026, 10, 11, 5, 23), "a sweep later the same day");
equal(nextSweepAt(rules, Date.UTC(2026, 10, 11, 5, 23)), Date.UTC(2026, 10, 11, 5, 23), "at the sweep itself");
equal(nextSweepAt(rules, NOW), Date.UTC(2026, 10, 12, 5, 23), "after today's sweep, tomorrow's");

// The clock in words.
const say = (clock: ReturnType<typeof closingClock>) => {
  if (!clock) throw new Error("expected a clock");
  return clockWords(clock, T3, NOW, "en-GB", "UTC");
};
equal(say(closingClock(noticed(), NOW)).text, "Closes in 41 h unless answered", "a running notice");
equal(say(closingClock(noticed(), NOW)).tone, "closed", "a running clock has the tone of a failing check");
const noticedAt = (at: number) => noticed({ closingNoticeAt: at, lastActivityAt: at + 1000 });
equal(say(closingClock(noticedAt(NOW - 71 * HOUR - 30 * MINUTE), NOW)).text, "Closes in 30 min unless answered", "minutes left");
equal(say(closingClock(noticedAt(NOW - HOUR - 1), NOW)).text, "Closes in 70 h unless answered", "hours left round down");
equal(formatCountdown(30 * 1000), "<1 min", "under a minute left");
equal(formatCountdown(4 * DAY - 1), "95 h", "hours up to four days");
equal(formatCountdown(4 * DAY), "4 d", "days from four");
equal(
  say(closingClock(noticed({ closingNoticeAt: NOW - 80 * HOUR, lastActivityAt: NOW - 80 * HOUR }), NOW)).text,
  "Due to close at the next daily sweep unless answered",
  "a notice past its deadline"
);
equal(
  say(closingClock(noticed({ closingNoticeAt: NOW - 80 * HOUR, lastActivityAt: NOW - 80 * HOUR }), NOW)).title.includes("12 Nov 2026, 05:23"),
  true,
  "the tooltip names the next sweep"
);
equal(say(closingClock(noticed({ lastActivityAt: NOW - HOUR }), NOW)).text, "Notice answered, back for another look", "an answered notice");
equal(say(closingClock(noticed({ lastActivityAt: NOW - HOUR }), NOW)).tone, "dim", "an answered notice is quiet");
equal(say(closingClock(noticed({ closingNoticeAt: null }), NOW)).text, "Closing notice, time not known", "a notice of unknown time");
equal(
  say(closingClock(labelled(["needs-rebase"], { lastActivityAt: Date.UTC(2026, 10, 14, 5, 33) }), Date.UTC(2026, 10, 14, 12))).text,
  "Closes after 21 Nov unless rebased",
  "a rebase request names the day"
);
equal(
  say(closingClock(labelled(["needs-rebase"], { lastActivityAt: NOW - 8 * DAY }), NOW)).text,
  "Due to close at the next daily sweep unless rebased",
  "a rebase request past its deadline"
);
equal(formatDayMonth(Date.UTC(2026, 10, 21, 5, 33), "en-GB", "UTC"), "21 Nov", "day and month");
equal(hasThreadSignals(link(), NOW), false, "a bare thread has no signals");
equal(hasThreadSignals(labelled(["needs-rebase"]), NOW), true, "a clock is a signal");
equal(hasThreadSignals(link({ ci: "success" }), NOW), true, "CI is a signal");

// The queue for a slot: ranked first in rank order, then unranked, longest-waiting first.
const queued = (id: string, queueRank: number | null, waitingSince: number) => ({ id, queueRank, waitingSince });
equal(
  ids(queueOrder([queued("late", null, NOW), queued("three", 3, NOW - DAY), queued("early", null, NOW - DAY), queued("one", 1, NOW)])),
  ["one", "three", "early", "late"],
  "queue order"
);
equal(ids(queueOrder([queued("b", 2, NOW), queued("a", 2, NOW - DAY)])), ["a", "b"], "equal ranks: the longest-waiting first");
equal(queueOrder([]), [], "an empty queue");

// Text approved: the newest text-approval ask decides.
const textAsk = (openedAt: number, isOpen: boolean, kind = "text_approval") => ({ kind, openedAt, isOpen });
equal(textApproval([]), "none", "no asks, no text yet");
equal(textApproval([textAsk(NOW, true, "route_decision"), textAsk(NOW, false, "open_on_nod")]), "none", "other kinds do not count");
equal(textApproval([textAsk(NOW - DAY, false)]), "approved", "a closed text approval is an approval");
equal(textApproval([textAsk(NOW - DAY, true)]), "awaiting", "an open one awaits approval");
equal(textApproval([textAsk(NOW - 2 * DAY, false), textAsk(NOW - DAY, true)]), "awaiting", "a newer open ask outranks an older approval");
equal(textApproval([textAsk(NOW - DAY, false), textAsk(NOW - 2 * DAY, true)]), "approved", "a newer approval outranks an older open ask");
equal(textApprovalWords("approved").text, "Text approved", "approved, in words");
equal(textApprovalWords("awaiting").text, "Text awaits approval", "awaiting, in words");
equal(textApprovalWords("none").text, "No text yet", "none, in words");

equal(slotWords(0, 3), "All 3 free", "no slot in use");
equal(slotWords(2, 3), "2 of 3 in use, 1 free", "one free");
equal(slotWords(3, 3), "3 of 3 in use, none free", "full");
equal(slotWords(5, 3), "5 open, 2 over the limit of 3", "over the limit");

// Waiting on a PR slot, and the kinds of change.
equal(WAITING_ON.includes("pr_slot"), true, "pr_slot is something an item can wait on");
equal(WAITING_ON_LABELS.pr_slot, "A PR slot", "its label");
equal(CHANGE_KINDS, ["bug", "behaviour_change", "feature"], "the kinds of change");
equal(CHANGE_KINDS.map((kind) => CHANGE_KIND_LABELS[kind]), ["Bug", "Behaviour change", "Feature"], "their labels");
equal(CHANGE_KINDS.every((kind) => CHANGE_KIND_DESCRIPTIONS[kind].length > 0), true, "each kind is described");
equal(parseFilters("?kind=feature").kind, "feature", "the kind filter is read");
equal(parseFilters("?kind=nonsense").kind, null, "an unknown kind is ignored");
equal(filtersToSearch({ ...parseFilters(""), kind: "behaviour_change" }), "?kind=behaviour_change", "the kind filter is written");
const kinded = [item("bug", { changeKind: "bug" }), item("feat", { changeKind: "feature" }), item("none")];
equal(ids(applyFilters(kinded, parseFilters("?kind=bug"))), ["bug"], "filter by kind");
equal(ids(applyFilters(kinded, parseFilters(""))), ["bug", "feat", "none"], "no kind filter keeps items with no verdict");

// Posts per week. Weeks start on Monday 00:00 UTC. NOW is a Wednesday.
const MONDAY = Date.UTC(2026, 10, 9);
equal(weekStartUtc(NOW), MONDAY, "Wednesday belongs to the week of its Monday");
equal(weekStartUtc(MONDAY), MONDAY, "Monday 00:00 starts its own week");
equal(weekStartUtc(MONDAY - 1), MONDAY - WEEK, "Sunday 23:59:59.999 belongs to the week before");
equal(weekStartUtc(Date.UTC(1970, 0, 1)), Date.UTC(1969, 11, 29), "the first Thursday of the epoch");
equal(postsWindowStart(NOW), MONDAY - 7 * WEEK, "eight weeks, the current one included");
const posts = countPosts(
  [
    NOW, // now: this week, and in the last 7 days
    MONDAY, // the first moment of this week
    MONDAY - 1, // last week, and in the last 7 days
    NOW - WEEK, // exactly 7 days ago: outside the last 7 days
    NOW - WEEK + 1, // inside them
    MONDAY - 7 * WEEK, // the first moment of the window
    MONDAY - 7 * WEEK - 1, // before it
    NOW + 1 // ahead of the clock
  ],
  NOW
);
equal(posts.weeks.length, POST_WEEKS, "one entry per week");
equal(posts.weeks.map((week) => week.count), [1, 0, 0, 0, 0, 0, 3, 2], "posts counted into their weeks");
equal(posts.weeks.map((week) => week.start)[7], MONDAY, "the last week is the current one");
equal(posts.weeks.map((week) => week.start)[0], MONDAY - 7 * WEEK, "the first is seven weeks before it");
equal(posts.last7Days, 4, "the last 7 days, the boundary excluded");
equal(countPosts([], NOW).last7Days, 0, "no posts");
equal(countPosts([NOW - HOUR, NOW - DAY + 1, NOW - DAY, NOW + HOUR], NOW).last24Hours, 2, "24 hours: the edge is out, and so is a post dated ahead");
equal(postStarts("https://github.com/pingdotgg/t3code/pull/33420"), "pr", "a PR's own address");
equal(postStarts("https://github.com/pingdotgg/t3code/issues/28178"), "issue", "an issue's own address");
equal(postStarts("https://github.com/pingdotgg/t3code/issues/28178#issuecomment-1"), null, "a comment starts nothing");
equal(postStarts("https://github.com/pingdotgg/t3code/pull/33420#pullrequestreview-1"), null, "a review reply starts nothing");
equal(postStarts("https://github.com/pingdotgg/t3code/discussions/25274"), null, "a discussion is neither");
equal(postStarts(null), null, "no URL");
equal(postStarts("https://github.com/pingdotgg/t3code/pull/1?plain=1"), "pr", "a query string is still the PR's own address");
equal(postStarts("https://github.com/pingdotgg/t3code/issues/2/?utm_source=x"), "issue", "and the issue's");
equal(postStarts("https://github.com/pingdotgg/t3code/pull/1?plain=1#discussion_r1"), null, "a fragment after a query is still a comment");
equal(
  countNewThreads(
    [
      { at: NOW - HOUR, url: "https://github.com/pingdotgg/t3code/pull/1" },
      { at: NOW - 2 * DAY, url: "https://github.com/pingdotgg/t3code/issues/2" },
      { at: NOW - 2 * DAY, url: "https://github.com/pingdotgg/t3code/issues/2#issuecomment-9" },
      { at: NOW - 8 * DAY, url: "https://github.com/pingdotgg/t3code/pull/3" },
      { at: NOW - HOUR }
    ],
    NOW
  ),
  { newPrsLast7Days: 1, newIssuesLast7Days: 1 },
  "new threads in the last 7 days"
);
equal(countPosts([], NOW).weeks.every((week) => week.count === 0), true, "no posts in any week");
console.log("ok  upstream rules");

console.log("all checks passed");
