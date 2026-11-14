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
import { closingClock, countPosts, postsWindowStart } from "../shared/upstreamRules";
import { checkBearer } from "./auth";
import { linkView, readSlotData } from "./read";
import type { ReadDb } from "./schema";

/**
 * Upstream posts over the last seven days and the last eight weeks. Every
 * upstream post is recorded as an event of type "posted"; this counts them on
 * every item, public or not, so the result is private.
 *
 * One index scan, over the posts of the window alone, newest first: when more
 * fell in it than one read takes, the oldest weeks count low and the result says so.
 */
export async function readPostCounts(db: ReadDb, now: number): Promise<PostCountsView> {
  const rows = await db.events
    .withIndex("by_type_at", (q) => q.eq("type", "posted").gte("at", postsWindowStart(now)))
    .order("desc")
    .take(LIMITS.maxPostsRead + 1);
  const counted = rows.slice(0, LIMITS.maxPostsRead);
  return {
    ...countPosts(
      counted.map((row) => row.at),
      now
    ),
    // No cap on posts has been set. The field is here for the day one is.
    cap: null,
    incomplete: rows.length > LIMITS.maxPostsRead
  };
}

/**
 * GET /api/agent/capacity: bearer AGENT_SECRET, read-only.
 *
 * Budget, of a handler's 100 index scans and 1,000 rows returned: the items
 * (one scan, at most LIMITS.maxItems rows), the PR slots (11 scans and 71 rows
 * at most, see readSlotData) and the posts (one scan, at most LIMITS.maxPostsRead
 * rows and one more). 13 scans and 722 rows at most.
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

  const response: CapacityResponse = { ok: true, generatedAt: now, repos, posts: await readPostCounts(db, now) };
  return json(response);
}
