// POST /api/refresh: bearer REFRESH_SECRET. Copies GitHub state onto links.
//
// One call handles one batch of links that are due: every link on an item that
// is not closed, and any link on a closed item that has never been read. It
// reads the batch, makes one GraphQL request, then writes. It records an event when a link
// merged, closed, reopened or began failing CI, or when upstream's bot put one of our
// PRs on a closing clock or its takeover pipeline moved one, and raises the item's
// "state changed upstream" marker.
// It never changes an item's stage.

import { json, type EndpointRequest, type EndpointResponse, type ServerContext } from "lakebed/server";
import type { RefreshResponse } from "../shared/api";
import type { EventType } from "../shared/enums";
import { CURSOR_PATTERN, LIMITS } from "../shared/limits";
import { rulesFor, sweepTimeUtc, takeoverLabel, takeoverState } from "../shared/upstreamRules";
import { AUTO_KEY_PREFIX, touchSyncState } from "./agent";
import { apiError, checkBearer } from "./auth";
import { DEFAULT_SELF_LOGIN, aliasFor, buildQuery, fetchGithub, snapshotFrom, type Snapshot } from "./github";
import type { LinkRow, WriteDb } from "./schema";

const MAX_ERROR_LENGTH = 300;

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Change = { type: EventType; note: string; noPush?: boolean };

/**
 * The clocks upstream's bot started on one of our open PRs since the stored
 * snapshot: a label that starts one is on the PR now and was not before. A link
 * read for the first time counts, because the clock runs whether or not it was
 * seen starting. While the label stays, later refreshes report nothing.
 */
function clockChangesFor(link: LinkRow, next: Snapshot): Change[] {
  const rules = rulesFor(link.repo);
  if (!rules || link.kind !== "pr" || link.ownership !== "ours" || next.state !== "open") return [];
  if (next.labels.includes(rules.keepOpenLabel)) return [];
  const before = new Set((link.ghLabels ?? "").split("\n"));
  const added = (label: string) => next.labels.includes(label) && !before.has(label);
  const ref = `${link.repo}#${link.number}`;
  const sweep = `daily sweep (${sweepTimeUtc(rules)} UTC)`;
  const changes: Change[] = [];
  // A notice that was lifted and given again between two refreshes leaves the labels as
  // they were. Its new time is what shows it.
  const renewed =
    next.labels.includes(rules.closingLabel) &&
    typeof link.ghClosingNoticeAt === "number" &&
    next.closingNoticeAt !== null &&
    next.closingNoticeAt !== link.ghClosingNoticeAt;
  if (added(rules.closingLabel) || renewed) {
    changes.push({
      type: "closing_notice",
      note: `${ref} got a closing notice. Unless something happens on it, upstream closes it at the first ${sweep} more than ${rules.noticeHours} hours after the notice.`
    });
  }
  if (added(rules.rebaseLabel)) {
    changes.push({
      type: "rebase_requested",
      note: `${ref} was asked to rebase. Upstream closes it at a ${sweep} once it has conflicted for ${rules.conflictIdleDays} days with no activity.`
    });
  }
  return changes;
}

/**
 * What upstream's takeover pipeline did with one of our open PRs since the stored
 * snapshot: the PR carries a pipeline label it did not carry before. A link read
 * for the first time counts. While the label stays, later refreshes report nothing.
 */
function pipelineChangesFor(link: LinkRow, next: Snapshot): Change[] {
  const takeover = rulesFor(link.repo)?.takeover;
  if (!takeover) return [];
  const state = takeoverState({
    repo: link.repo,
    kind: link.kind,
    ownership: link.ownership,
    state: next.state,
    labels: next.labels,
    pipelineMarker: markerToStore(link, next)
  });
  if (!state || state.label === takeoverLabel((link.ghLabels ?? "").split("\n"), takeover)) return [];
  // The note gives the label as GitHub has it. What to do about it is the agents' rule, not the site's.
  return [{ type: "pipeline_state", note: `${link.repo}#${link.number} now carries the label ${state.text}.`, noPush: state.noPush }];
}

const HOUR_MS = 3_600_000;

/**
 * The pipeline marker a link keeps after this read. One just read stands. With
 * none read, the stored one stands only while the PR's pipeline label is the
 * same and the read did not find it to be an earlier run's: a marker must never
 * pass as the reason for a stop it was not written about.
 */
function markerToStore(link: LinkRow, next: Snapshot): string | null {
  if (next.pipelineMarker !== null) return next.pipelineMarker;
  const takeover = rulesFor(link.repo)?.takeover;
  if (!takeover || next.pipelineMarkerStale) return null;
  const before = takeoverLabel((link.ghLabels ?? "").split("\n"), takeover);
  return takeoverLabel(next.labels, takeover) === before ? (link.ghPipelineMarker ?? null) : null;
}

/**
 * A few words for the note of one of our PRs that the pipeline closed: only when
 * its closing marker was read now and was written about when the PR closed.
 */
function markerNote(link: LinkRow, next: Snapshot): string {
  const takeover = rulesFor(link.repo)?.takeover;
  const marker = next.pipelineMarker;
  if (!takeover || !marker || link.kind !== "pr" || link.ownership !== "ours" || next.state !== "closed") return "";
  if (marker.startsWith(takeover.stopPrefix)) return "";
  const near = next.pipelineMarkerAt !== null && next.closedAt !== null && Math.abs(next.closedAt - next.pipelineMarkerAt) <= HOUR_MS;
  return near ? ` Upstream's pipeline closed it as: ${marker}.` : "";
}

/**
 * Compares the stored snapshot with the new one. A link never synced before
 * produces no change of state; a closing clock or a pipeline state is reported for it all the same.
 */
function changesFor(link: LinkRow, next: Snapshot): Change[] {
  // The last note is the one the item's marker carries: "nothing may be pushed" before anything, then a clock.
  const clocks = clockChangesFor(link, next);
  const pipeline = pipelineChangesFor(link, next);
  const labelled = pipeline.some((change) => change.noPush) ? [...clocks, ...pipeline] : [...pipeline, ...clocks];
  if (link.syncedAt === undefined || link.ghState === undefined) {
    return labelled;
  }
  const changes: Change[] = [];
  const ref = `${link.repo}#${link.number}`;
  const dependency = link.role === "base" || link.role === "covering";
  const label = dependency ? `${link.role === "base" ? "Base" : "Covering"} link ${ref}` : ref;

  if (link.ghState !== next.state) {
    if (next.state === "merged") {
      changes.push({ type: dependency ? "dependency_merged" : "upstream_merged", note: `${label} was merged.${markerNote(link, next)}` });
    } else if (next.state === "closed") {
      changes.push({
        type: dependency ? "dependency_closed" : "upstream_closed",
        note: `${label} was closed${link.kind === "pr" ? " without merging" : ""}.${markerNote(link, next)}`
      });
    } else {
      changes.push({ type: "upstream_reopened", note: `${label} was reopened.` });
    }
  }
  // CI is reported for our own open PRs only. Another contributor's red build is not ours to act on.
  if (link.ownership === "ours" && next.state === "open" && next.ci === "failure" && link.ghCi !== "failure") {
    changes.push({ type: "ci_failing", note: `CI began failing on ${ref}.` });
  }
  return [...changes, ...labelled];
}

export async function handleRefresh(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "REFRESH_SECRET");
  if (denied) return denied;
  const db = ctx.db as unknown as WriteDb;
  const now = Date.now();

  let cursor = req.query.get("cursor");
  if (cursor === "") cursor = null;
  const firstBatch = cursor === null;

  const fail = async (status: number, error: string, message: string): Promise<EndpointResponse> => {
    await touchSyncState(db, {
      lastGithubSyncAt: now,
      lastError: message.slice(0, MAX_ERROR_LENGTH),
      lastErrorAt: now,
      refreshRunFailed: true
    });
    const body: RefreshResponse = {
      ok: false,
      links: 0,
      refreshed: 0,
      failed: [],
      events: 0,
      // The same cursor again: the batch was not applied, so the caller may retry it.
      nextCursor: cursor,
      done: false,
      error,
      message
    };
    return json(body, { status });
  };

  const token = ctx.env.GITHUB_TOKEN;
  if (!token) {
    return fail(503, "not_configured", "The server secret GITHUB_TOKEN is not set.");
  }

  // A database error cannot be caught and recovered from inside a handler, so a
  // cursor that is plainly not one of ours is refused before it reaches the database.
  if (cursor !== null && !CURSOR_PATTERN.test(cursor)) {
    return apiError(400, "invalid_cursor", "The cursor is not one this endpoint returned. Start the refresh again without one.");
  }
  const page = await db.links
    .withIndex("by_sync_due", (q) => q.eq("syncDue", true))
    .paginate({ cursor, numItems: LIMITS.refreshLinksPerBatch });
  const links = page.page;
  const nextCursor = page.isDone ? null : page.continueCursor;

  let refreshed = 0;
  let eventCount = 0;
  let rateLimitRemaining: number | null = null;
  const failed: RefreshResponse["failed"] = [];

  if (links.length > 0) {
    // Fetch first. Nothing has been written yet, so a failure here loses nothing.
    // GITHUB_GRAPHQL_URL is for tests against a stand-in server. Leave it unset in a deploy.
    const result = await fetchGithub(token, buildQuery(links), ctx.env.GITHUB_GRAPHQL_URL || undefined);
    if (!result.ok) {
      ctx.log.warn("GitHub refresh failed", { message: result.message, links: links.length });
      return fail(502, "github_failed", result.message);
    }
    rateLimitRemaining = result.rateLimitRemaining;
    const selfLogin = ctx.env.GITHUB_SELF_LOGIN || DEFAULT_SELF_LOGIN;
    // An item's marker carries one note. Across all its links the weightiest stands: a
    // pipeline state that forbids a push, then a closing clock, then anything else. Of equals, the last.
    const marked = new Map<string, { note: string; weight: number }>();
    const weightOf = (change: Change) =>
      change.noPush ? 3 : change.type === "closing_notice" || change.type === "rebase_requested" ? 2 : 1;

    for (const [index, link] of links.entries()) {
      const alias = aliasFor(index);
      const repository = result.data[alias];
      // An error anywhere under this link's alias means some of its fields came back
      // null. A snapshot built from that would overwrite good values, so the link fails whole.
      const aliasError = result.errorsByAlias.get(alias);
      const snapshot =
        aliasError === undefined && isObj(repository)
          ? snapshotFrom(repository.node, selfLogin, rulesFor(link.repo))
          : null;
      if (!snapshot) {
        // Keep the old snapshot. Only note that this link could not be read.
        const message = aliasError ?? "GitHub returned nothing usable for this link.";
        failed.push({ url: link.url, message });
        if (link.syncError !== message || link.syncDue !== link.active) {
          // A link on a closed item is tried once. The agent can fix it and it becomes due again.
          await db.links.update(link.id, { syncError: message, syncDue: link.active });
        }
        continue;
      }

      const changes = changesFor(link, snapshot);
      await db.links.update(link.id, {
        ghTitle: snapshot.title,
        ghState: snapshot.state,
        ghCreatedAt: snapshot.createdAt,
        ghIsDraft: snapshot.isDraft,
        ghMergedAt: snapshot.mergedAt,
        ghClosedAt: snapshot.closedAt,
        ghCi: snapshot.ci,
        ghReviewDecision: snapshot.reviewDecision,
        ghLabels: snapshot.labels.length > 0 ? snapshot.labels.join("\n") : null,
        ghHeadSha: snapshot.headSha,
        ghLastActivityAt: snapshot.lastActivityAt,
        // Null clears it: the time is kept only while the PR carries the closing label.
        ghClosingNoticeAt: snapshot.closingNoticeAt,
        ghMergeable: snapshot.mergeable,
        // The query reads only recent comments and reviews. When none of them is by
        // another person, an older stored value still stands.
        ...(snapshot.otherActivityAt !== null && snapshot.otherActivityBy !== null
          ? { ghOtherActivityAt: snapshot.otherActivityAt, ghOtherActivityBy: snapshot.otherActivityBy }
          : {}),
        ...(snapshot.macroscopeVerdict !== null ? { macroscopeVerdict: snapshot.macroscopeVerdict } : {}),
        // Few comments are read for the marker: see markerToStore for when a stored one still stands.
        ...(snapshot.pipelineMarker !== null
          ? { ghPipelineMarker: snapshot.pipelineMarker, ghPipelineMarkerAt: snapshot.pipelineMarkerAt }
          : markerToStore(link, snapshot) === null
            ? { ghPipelineMarker: null, ghPipelineMarkerAt: null }
            : {}),
        syncedAt: now,
        syncError: null,
        syncDue: link.active
      });
      refreshed += 1;

      for (const [changeIndex, change] of changes.entries()) {
        await db.events.insert({
          key: `${AUTO_KEY_PREFIX}gh:${link.id}:${change.type}:${now}:${changeIndex}`,
          itemId: link.itemId,
          at: now,
          actor: "github",
          type: change.type,
          note: change.note,
          url: link.url,
          isPublic: true
        });
        eventCount += 1;
        const weight = weightOf(change);
        if (weight >= (marked.get(link.itemId)?.weight ?? 0)) marked.set(link.itemId, { note: change.note, weight });
      }
    }

    // Raise the marker. The stage is the agent's to change.
    for (const [itemId, { note }] of marked) {
      await db.items.update(itemId, { upstreamChangedAt: now, upstreamChangeNote: note });
    }
  }

  const state = await db.syncState.withIndex("by_creation").first();
  const earlierBatchFailed = !firstBatch && state?.refreshRunFailed === true;
  const batchFailed = failed.length > 0;
  const runFailed = earlierBatchFailed || batchFailed;
  const done = nextCursor === null;
  const first = failed[0];
  // A refresh changes links, events and items too, so it moves the export revision like an agent write.
  const patch: Parameters<typeof touchSyncState>[1] & { revision?: number } = {
    lastGithubSyncAt: now,
    refreshRunFailed: runFailed,
    ...(links.length > 0 ? { revision: (state?.revision ?? 0) + 1 } : {})
  };
  if (batchFailed && first) {
    // This text is public. It must not name a link: the link may belong to a
    // non-public item. Each link's own error is stored on the link row.
    patch.lastError = `${failed.length} of ${links.length} links could not be refreshed. ${first.message}`.slice(0, MAX_ERROR_LENGTH);
    patch.lastErrorAt = now;
  } else if (done && !runFailed) {
    // A whole run with no failure clears the last error.
    patch.lastGithubOkAt = now;
    patch.lastError = null;
    patch.lastErrorAt = null;
  }
  if (state) {
    await db.syncState.update(state.id, patch);
  } else {
    await db.syncState.insert(patch);
  }

  const body: RefreshResponse = {
    ok: true,
    links: links.length,
    refreshed,
    failed,
    events: eventCount,
    nextCursor,
    done,
    rateLimitRemaining
  };
  return json(body);
}
