// POST /api/refresh: bearer REFRESH_SECRET. Copies GitHub state onto links.
//
// One call handles one batch of links on items that are not closed: read the
// batch, make one GraphQL request, then write. It records an event when a link
// merged, closed, reopened or began failing CI, and raises the item's
// "state changed upstream" marker. It never changes an item's stage.

import { json, type EndpointRequest, type EndpointResponse, type ServerContext } from "lakebed/server";
import type { RefreshResponse } from "../shared/api";
import type { EventType } from "../shared/enums";
import { LIMITS } from "../shared/limits";
import { AUTO_KEY_PREFIX, touchSyncState } from "./agent";
import { apiError, checkBearer } from "./auth";
import { DEFAULT_SELF_LOGIN, aliasFor, buildQuery, fetchGithub, snapshotFrom, type Snapshot } from "./github";
import type { LinkRow, WriteDb } from "./schema";

const MAX_ERROR_LENGTH = 300;

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type Change = { type: EventType; note: string };

/** Compares the stored snapshot with the new one. A link never synced before produces no change. */
function changesFor(link: LinkRow, next: Snapshot): Change[] {
  if (link.syncedAt === undefined || link.ghState === undefined) {
    return [];
  }
  const changes: Change[] = [];
  const ref = `${link.repo}#${link.number}`;
  const dependency = link.role === "base" || link.role === "covering";
  const label = dependency ? `${link.role === "base" ? "Base" : "Covering"} link ${ref}` : ref;

  if (link.ghState !== next.state) {
    if (next.state === "merged") {
      changes.push({ type: dependency ? "dependency_merged" : "upstream_merged", note: `${label} was merged.` });
    } else if (next.state === "closed") {
      changes.push({
        type: dependency ? "dependency_closed" : "upstream_closed",
        note: `${label} was closed${link.kind === "pr" ? " without merging" : ""}.`
      });
    } else {
      changes.push({ type: "upstream_reopened", note: `${label} was reopened.` });
    }
  }
  // CI is reported for our own open PRs only. Another contributor's red build is not ours to act on.
  if (link.ownership === "ours" && next.state === "open" && next.ci === "failure" && link.ghCi !== "failure") {
    changes.push({ type: "ci_failing", note: `CI began failing on ${ref}.` });
  }
  return changes;
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

  let page;
  try {
    page = await db.links
      .withIndex("by_active", (q) => q.eq("active", true))
      .paginate({ cursor, numItems: LIMITS.refreshLinksPerBatch });
  } catch {
    return apiError(400, "invalid_cursor", "The cursor is not valid any more. Start the refresh again without one.");
  }
  const links = page.page;
  const nextCursor = page.isDone ? null : page.continueCursor;

  let refreshed = 0;
  let eventCount = 0;
  let rateLimitRemaining: number | null = null;
  const failed: RefreshResponse["failed"] = [];

  if (links.length > 0) {
    // Fetch first. Nothing has been written yet, so a failure here loses nothing.
    const result = await fetchGithub(token, buildQuery(links));
    if (!result.ok) {
      ctx.log.warn("GitHub refresh failed", { message: result.message, links: links.length });
      return fail(502, "github_failed", result.message);
    }
    rateLimitRemaining = result.rateLimitRemaining;
    const selfLogin = ctx.env.GITHUB_SELF_LOGIN || DEFAULT_SELF_LOGIN;
    const marked = new Map<string, string>();

    for (const [index, link] of links.entries()) {
      const alias = aliasFor(index);
      const repository = result.data[alias];
      const snapshot = isObj(repository) ? snapshotFrom(repository.node, selfLogin) : null;
      if (!snapshot) {
        // Keep the old snapshot. Only note that this link could not be read.
        const message = result.errorsByAlias.get(alias) ?? "GitHub returned nothing usable for this link.";
        failed.push({ url: link.url, message });
        if (link.syncError !== message) {
          await db.links.update(link.id, { syncError: message });
        }
        continue;
      }

      const changes = changesFor(link, snapshot);
      await db.links.update(link.id, {
        ghTitle: snapshot.title,
        ghState: snapshot.state,
        ghIsDraft: snapshot.isDraft,
        ghMergedAt: snapshot.mergedAt,
        ghClosedAt: snapshot.closedAt,
        ghCi: snapshot.ci,
        ghReviewDecision: snapshot.reviewDecision,
        ghLabels: snapshot.labels.length > 0 ? snapshot.labels.join("\n") : null,
        ghHeadSha: snapshot.headSha,
        ghLastActivityAt: snapshot.lastActivityAt,
        // The query reads only recent comments and reviews. When none of them is by
        // another person, an older stored value still stands.
        ...(snapshot.otherActivityAt !== null && snapshot.otherActivityBy !== null
          ? { ghOtherActivityAt: snapshot.otherActivityAt, ghOtherActivityBy: snapshot.otherActivityBy }
          : {}),
        ...(snapshot.macroscopeVerdict !== null ? { macroscopeVerdict: snapshot.macroscopeVerdict } : {}),
        syncedAt: now,
        syncError: null
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
        marked.set(link.itemId, change.note);
      }
    }

    // Raise the marker. The stage is the agent's to change.
    for (const [itemId, note] of marked) {
      await db.items.update(itemId, { upstreamChangedAt: now, upstreamChangeNote: note });
    }
  }

  const state = await db.syncState.withIndex("by_creation").first();
  const earlierBatchFailed = !firstBatch && state?.refreshRunFailed === true;
  const batchFailed = failed.length > 0;
  const runFailed = earlierBatchFailed || batchFailed;
  const done = nextCursor === null;
  const first = failed[0];
  const patch: Parameters<typeof touchSyncState>[1] = { lastGithubSyncAt: now, refreshRunFailed: runFailed };
  if (batchFailed && first) {
    patch.lastError = `${failed.length} of ${links.length} links could not be refreshed. First: ${first.url}: ${first.message}`.slice(
      0,
      MAX_ERROR_LENGTH
    );
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
