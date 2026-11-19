// Capacity: how many PR slots are free, who is next for one, and how many posts
// went upstream lately. For the owner and the agents only.
//
// Everything here takes a ReadDb, the database type with the private tables.
// A public query holds a PublicDb, so it cannot call these: the post count
// includes posts on non-public items, and the agent's view of the queue names them.

import { json, type EndpointRequest, type EndpointResponse, type QueryServerContext } from "lakebed/server";
import type { CapacityRepo, CapacityResponse, PostCountsView } from "../shared/api";
import type { ChangeKind, GhCi, GhState, Stage } from "../shared/enums";
import { isItemNumber, itemIdOf } from "../shared/itemId";
import { LIMITS } from "../shared/limits";
import { POSTING_CAPS, closingClock, countNewThreads, countPosts, githubPosts, postsWindowStart, takeoverState } from "../shared/upstreamRules";
import { checkBearer } from "./auth";
import { linkView, readSlotData } from "./read";
import type { ReadDb } from "./schema";

/**
 * Our upstream posts over the last seven days and the last eight weeks. Private.
 *
 * Counted from GitHub when every repository with rules has a stored read no
 * older than two hours (see server/posts.ts): that covers the whole account,
 * posts made outside the agents included. `login` is the GITHUB_LOGIN secret;
 * without it nothing is read from GitHub, so what is stored is not used.
 *
 * Otherwise counted from the events of type "posted", on every item, public or
 * not: one index scan over the window, newest first. That count misses every
 * post nobody recorded, so it is marked incomplete.
 */
export async function readPostCounts(db: ReadDb, now: number, login: string | undefined): Promise<PostCountsView> {
  const caps = {
    cap: POSTING_CAPS.perWeek,
    dailyCap: POSTING_CAPS.perDay,
    newPrCap: POSTING_CAPS.newPrsPerWeek,
    newIssueCap: POSTING_CAPS.newIssuesPerWeek
  };
  const stored = login?.trim() ? githubPosts(await db.githubPosts.withIndex("by_creation").take(LIMITS.maxPostRows), now) : null;
  if (stored) {
    return {
      source: "github",
      countedAt: stored.countedAt,
      ...countPosts(
        stored.posts.map((post) => post.at),
        now
      ),
      ...countNewThreads(stored.posts, now),
      ...caps,
      incomplete: stored.incomplete
    };
  }
  const rows = await db.events
    .withIndex("by_type_at", (q) => q.eq("type", "posted").gte("at", postsWindowStart(now)))
    .order("desc")
    .take(LIMITS.maxPostsRead);
  return {
    source: "events",
    countedAt: null,
    ...countPosts(
      rows.map((row) => row.at),
      now
    ),
    ...countNewThreads(
      rows.map((row) => ({ at: row.at, url: row.url })),
      now
    ),
    ...caps,
    incomplete: true
  };
}

/**
 * GET /api/agent/capacity: bearer AGENT_SECRET, read-only.
 *
 * Budget, of a handler's 100 index scans and 1,000 rows returned: the items
 * (one scan, at most LIMITS.maxItems rows), the PR slots (11 scans and 71 rows
 * at most, see readSlotData) and the posts (two scans: the stored GitHub reads, at
 * most LIMITS.maxPostRows rows, and on the fallback the events, at most
 * LIMITS.maxPostsRead rows). 14 scans and 741 rows at most.
 */
export async function handleCapacity(ctx: QueryServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "AGENT_SECRET");
  if (denied) return denied;
  const db = ctx.db as unknown as ReadDb;
  const now = Date.now();

  const items = await db.items.withIndex("by_creation").take(LIMITS.maxItems);
  const data = await readSlotData(db, items, true);
  const repos: CapacityRepo[] = data.map(({ repo, rules, slots, queue, incomplete }) => ({
    repo,
    limit: rules.openPrLimit,
    open: slots.length,
    free: incomplete ? 0 : Math.max(0, rules.openPrLimit - slots.length),
    incomplete,
    slots: slots.map(({ link, item }) => ({
      url: link.url,
      repo: link.repo,
      number: link.number,
      title: link.ghTitle ?? null,
      itemSlug: item.slug,
      itemNumber: isItemNumber(item.number) ? item.number : null,
      itemShortId: itemIdOf(item),
      itemTitle: item.title,
      itemIsPublic: item.isPublic,
      ghState: (link.ghState as GhState | undefined) ?? null,
      isDraft: link.ghIsDraft ?? null,
      createdAt: link.ghCreatedAt ?? null,
      ci: (link.ghCi as GhCi | undefined) ?? null,
      labels: link.ghLabels ? link.ghLabels.split("\n") : [],
      lastActivityAt: link.ghLastActivityAt ?? null,
      closingClock: closingClock(linkView(link), now),
      takeover: takeoverState(linkView(link), now),
      syncedAt: link.syncedAt ?? null
    })),
    queue: queue.map(({ item, text }, index) => ({
      position: index + 1,
      itemSlug: item.slug,
      itemNumber: isItemNumber(item.number) ? item.number : null,
      itemShortId: itemIdOf(item),
      itemTitle: item.title,
      itemIsPublic: item.isPublic,
      itemStage: item.stage as Stage,
      queueRank: item.queueRank ?? null,
      waitingSince: item.waitingSince,
      text,
      changeKind: (item.changeKind as ChangeKind | undefined) ?? null
    }))
  }));

  const response: CapacityResponse = { ok: true, generatedAt: now, repos, posts: await readPostCounts(db, now, ctx.env.GITHUB_LOGIN) };
  return json(response);
}
