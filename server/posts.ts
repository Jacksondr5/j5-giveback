// POST /api/refresh/posts: bearer REFRESH_SECRET. Reads our account's own posts from
// GitHub, in every repository with rules, and stores a time and a kind for each.
// The post count reads them (server/capacity.ts). The table is private.

import { json, type EndpointRequest, type EndpointResponse, type ServerContext } from "lakebed/server";
import type { RefreshPostsResponse } from "../shared/api";
import { LIMITS } from "../shared/limits";
import { RULES_REPOS, formatPosts, postsWindowStart } from "../shared/upstreamRules";
import { apiError, checkBearer } from "./auth";
import { fetchGithub } from "./github";
import { buildPostsQuery, postsFrom } from "./postsQuery";
import type { WriteDb } from "./schema";

// The login goes into a search string, so only the characters of a login are let through.
const LOGIN_PATTERN = /^[A-Za-z0-9](?:-?[A-Za-z0-9]){0,38}$/;

/**
 * One GitHub request, whatever the number of repositories: each adds six
 * searches to the same query. With one repository GitHub answered in 1.3 to 2.6
 * seconds when this was written, inside the fetch's 3.5 seconds and the
 * handler's 5. Each further repository slows the one answer. Past the timeout
 * the read fails whole, the rows keep their old posts, and after two hours the
 * count falls back to the recorded events. A second repository may well need
 * the read split into one call per repository.
 */
export async function handleRefreshPosts(ctx: ServerContext, req: EndpointRequest): Promise<EndpointResponse> {
  const denied = checkBearer(ctx.env, req, "REFRESH_SECRET");
  if (denied) return denied;
  const login = (ctx.env.GITHUB_LOGIN ?? "").trim();
  if (!login) {
    // Nothing is fetched and nothing is written. The count comes from the recorded events.
    const body: RefreshPostsResponse = { ok: true, configured: false, repos: [] };
    return json(body);
  }
  const token = ctx.env.GITHUB_TOKEN;
  if (!token || !LOGIN_PATTERN.test(login)) {
    return apiError(503, "not_configured", token ? "The server secret GITHUB_LOGIN is not a GitHub login." : "The server secret GITHUB_TOKEN is not set.");
  }
  const db = ctx.db as unknown as WriteDb;
  const now = Date.now();
  const since = postsWindowStart(now);

  const rows = await db.githubPosts.withIndex("by_creation").take(LIMITS.maxPostRows);
  const result = await fetchGithub(token, buildPostsQuery(RULES_REPOS, login, since), ctx.env.GITHUB_GRAPHQL_URL || undefined);
  // An error beside the data means some field came back null. A count built on that would be low.
  const parsed = result.ok ? (result.firstError ?? postsFrom(result.data, RULES_REPOS, login, since)) : result.message;
  const read = typeof parsed === "string" ? null : parsed;
  const message = typeof parsed === "string" ? parsed.slice(0, 300) : "";

  const repos: RefreshPostsResponse["repos"] = [];
  for (const repo of RULES_REPOS) {
    const row = rows.find((candidate) => candidate.repo === repo);
    const entry = read?.get(repo);
    // A failed read keeps the posts and the time of the last good one, and notes the failure beside them.
    const fields = entry ? { readAt: now, incomplete: entry.incomplete, posts: formatPosts(entry.posts) } : { error: message, errorAt: now };
    if (!row) await db.githubPosts.insert({ repo, ...fields });
    else await db.githubPosts.update(row.id, entry ? { ...fields, error: null, errorAt: null } : fields);
    if (entry) repos.push({ repo, incomplete: entry.incomplete });
  }
  // The rows are in the export, so a write here moves its revision like any other:
  // an export whose pages straddle this call can tell, and starts again.
  const state = await db.syncState.withIndex("by_creation").first();
  if (state) await db.syncState.update(state.id, { revision: (state.revision ?? 0) + 1 });
  else await db.syncState.insert({ revision: 1 });

  if (!read) {
    ctx.log.warn("GitHub post read failed", { message });
    const body: RefreshPostsResponse = { ok: false, configured: true, repos, error: "github_failed", message };
    return json(body, { status: 502 });
  }
  const body: RefreshPostsResponse = { ok: true, configured: true, repos, rateLimitRemaining: result.ok ? result.rateLimitRemaining : null };
  return json(body);
}
