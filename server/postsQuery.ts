// The GitHub query that reads our account's own posts, and the reading of its answer.
// Pure: no fetch, no database, no Lakebed. client/lib/lib.check.ts checks it.

import { LIMITS } from "../shared/limits";
import type { Post, PostKind } from "../shared/upstreamRules";
import { isObj, time } from "./github";

type Obj = Record<string, unknown>;

// Page sizes. A full page may have cut posts off: see `page` in postsFrom.
const COMMENTS = 100;
const REVIEWS = 50;
const REOPENS = 10;
const DISCUSSIONS = 20;
const DISCUSSION_COMMENTS = 50;
// Upstream's open-PR limit closes a PR within seconds of its opening, as this account.
const LIMIT_BOT = "github-actions";
const LIMIT_CLOSE_WITHIN_MS = 10 * 60_000;

// The comment connection has no author filter: a thread's last comments are read and ours kept.
const COMMENTS_OF = (type: string) => `...on ${type}{comments(last:${COMMENTS}){nodes{author{login} createdAt}}}`;
const DISCUSSION_COMMENT_FIELDS = "{nodes{id createdAt discussion{repository{nameWithOwner}}}}";

/**
 * One query. Per repository, six searches: the PRs (p<n>) and issues (i<n>) the
 * account opened, the PRs it reviewed (r<n>), the PRs (c<n>) and issues (m<n>)
 * it commented on, and every PR there is (k<n>), as a control. Then, once, the
 * account's discussion posts.
 *
 * Every search says `is:pr` or `is:issue`. Without one, GitHub answers a
 * fine-grained token with no results and no error, for a repository the token
 * was not granted. The control catches that if it ever comes back: see postsFrom.
 *
 * `repositoryDiscussions` is newest first by default. `repositoryDiscussionComments`
 * states no order, so both ends are read (f, l).
 */
export function buildPostsQuery(repos: readonly string[], login: string, since: number): string {
  const day = new Date(since).toISOString().slice(0, 10);
  const user = JSON.stringify(login);
  const parts = repos.flatMap((repo, n) => {
    const search = (alias: string, first: number, what: string, fields: string) =>
      `${alias}${n}:search(type:ISSUE,first:${first},query:"repo:${repo} ${what}"){issueCount ${fields}}`;
    const mine = (alias: string, first: number, what: string, fields: string) =>
      search(alias, first, `${what}:${login} updated:>=${day} sort:updated-desc`, `nodes{${fields}}`);
    return [
      mine(
        "p",
        100,
        "is:pr author",
        `...on PullRequest{createdAt state headRefName headRepository{nameWithOwner} timelineItems(itemTypes:[REOPENED_EVENT],last:${REOPENS}){nodes{...on ReopenedEvent{createdAt actor{login}}}} closes:timelineItems(itemTypes:[CLOSED_EVENT],last:1){nodes{...on ClosedEvent{createdAt actor{login}}}}}`
      ),
      mine("i", 100, "is:issue author", "...on Issue{createdAt}"),
      mine("r", 50, "is:pr reviewed-by", `...on PullRequest{reviews(author:${user},last:${REVIEWS}){nodes{submittedAt}}}`),
      mine("c", 50, "is:pr commenter", COMMENTS_OF("PullRequest")),
      mine("m", 50, "is:issue commenter", COMMENTS_OF("Issue")),
      search("k", 1, "is:pr", "")
    ];
  });
  return `query{rateLimit{remaining}
${parts.join("\n")}
user(login:${user}){d:repositoryDiscussions(first:${DISCUSSIONS}){nodes{createdAt repository{nameWithOwner}}} f:repositoryDiscussionComments(first:${DISCUSSION_COMMENTS})${DISCUSSION_COMMENT_FIELDS} l:repositoryDiscussionComments(last:${DISCUSSION_COMMENTS})${DISCUSSION_COMMENT_FIELDS}}}`;
}

export type PostsRead = { posts: Post[]; incomplete: boolean };

/**
 * Each repository's posts inside the window, newest first. Or, as a string, why
 * the read fails whole: a part of the response is missing, or the control search
 * found no PR at all in a repository. A count built on either would be low.
 *
 * Incomplete: a search found more threads than it returned, a page came back
 * full with nothing in it older than the window, or more posts were found than a row keeps.
 *
 * Nothing unreadable is skipped. A connection that is missing, or a node that is
 * null, fails the read: GitHub puts a null where it could not load something, and
 * a count that left it out would be low and look complete.
 */
export function postsFrom(data: Obj, repos: readonly string[], login: string, since: number): Map<string, PostsRead> | string {
  const user = data.user;
  // The message is stored and returned, so it does not name the login.
  if (!isObj(user)) return "GitHub has no user of that login.";
  let unreadable = false;
  /** A connection's nodes, every one of them. Anything else marks the answer unreadable. */
  const all = (connection: unknown): Obj[] => {
    const list = isObj(connection) ? connection.nodes : null;
    if (!Array.isArray(list) || !list.every(isObj)) {
      unreadable = true;
      return [];
    }
    return list as Obj[];
  };
  const mine = (actor: unknown) => isObj(actor) && typeof actor.login === "string" && actor.login.toLowerCase() === login.toLowerCase();
  const inWindow = (list: Obj[], field: string) => list.every((node) => (time(node[field]) ?? since) >= since);
  const newest = (list: Obj[]) => Math.max(0, ...list.map((node) => time(node.createdAt) ?? 0));

  // Discussion comments, from both ends. Two full pages with no overlap leave a gap between
  // them; the gap can hold posts of the window only if the newer page is all inside it.
  const ends = [all(user.f), all(user.l)] as const;
  const discussions = all(user.d);
  const discussionComments = new Map(ends.flat().map((comment) => [comment.id, comment]));
  const newer = newest(ends[0]) >= newest(ends[1]) ? ends[0] : ends[1];
  const gap = discussionComments.size >= 2 * DISCUSSION_COMMENTS && inWindow(newer, "createdAt");

  const out = new Map<string, PostsRead>();
  for (const [n, repo] of repos.entries()) {
    const posts: Post[] = [];
    let incomplete = gap;
    const add = (kind: PostKind, value: unknown) => {
      const at = time(value);
      if (at !== null && at >= since) posts.push({ at, kind });
    };
    const page = (connection: unknown, size: number, field: string): Obj[] => {
      const list = all(connection);
      if (list.length >= size && inWindow(list, field)) incomplete = true;
      return list;
    };
    const searched = (alias: string): Obj[] | null => {
      const result = data[alias + n];
      if (!isObj(result) || typeof result.issueCount !== "number") return null;
      const list = all(result);
      if (result.issueCount > list.length) incomplete = true;
      return list;
    };
    const here = (holder: unknown) =>
      isObj(holder) && isObj(holder.repository) && String(holder.repository.nameWithOwner).toLowerCase() === repo.toLowerCase();
    const control = data[`k${n}`];
    if (!isObj(control) || !control.issueCount) return `GitHub's search found no PR in ${repo}: this token cannot search it.`;
    const prs = searched("p");
    const issues = searched("i");
    const reviewed = searched("r");
    const onPrs = searched("c");
    const onIssues = searched("m");
    if (!prs || !issues || !reviewed || !onPrs || !onIssues) return `GitHub's answer for ${repo} lacks a search.`;

    // A PR the limit bot closed as it opened is found too, and counts as a new PR.
    // The PR that later takes its place does not: we cannot reopen what the bot closed,
    // so upstream has us open another from the same branch, and it counts as a reopen.
    //
    // Calling a new PR a replacement would make the count low, so every doubt counts
    // as a new PR. A PR is a replacement only when the account's PR just before it, on
    // the same branch of the same head repository, is closed now, and its last close
    // was the limit bot's, within minutes of its opening, inside the window, and before
    // this PR was opened. With the search cut short, a PR between the two may be
    // missing, so nothing is called a replacement.
    const cutShort = (data[`p${n}`] as Obj).issueCount !== prs.length;
    const dated = prs
      .map((pr) => {
        const close = all(pr.closes)[0];
        const opened = time(pr.createdAt);
        const closed = close ? time(close.createdAt) : null;
        const limitClosedAt =
          pr.state === "CLOSED" &&
          isObj(close) &&
          isObj(close.actor) &&
          close.actor.login === LIMIT_BOT &&
          opened !== null &&
          closed !== null &&
          closed >= since &&
          closed - opened <= LIMIT_CLOSE_WITHIN_MS
            ? closed
            : null;
        const repoName = isObj(pr.headRepository) && typeof pr.headRepository.nameWithOwner === "string" ? pr.headRepository.nameWithOwner : "";
        const branch = repoName !== "" && typeof pr.headRefName === "string" && pr.headRefName !== "" ? `${repoName.toLowerCase()}:${pr.headRefName}` : "";
        return { pr, opened, branch, limitClosedAt };
      })
      .sort((a, b) => (a.opened ?? 0) - (b.opened ?? 0));
    const lastOnBranch = new Map<string, number | null>();
    for (const { pr, opened, branch, limitClosedAt } of dated) {
      const before = branch === "" ? null : (lastOnBranch.get(branch) ?? null);
      const replaces = !cutShort && before !== null && opened !== null && before < opened;
      add(replaces ? "reopen" : "pr", pr.createdAt);
      if (branch !== "") lastOnBranch.set(branch, limitClosedAt);
      for (const event of page(pr.timelineItems, REOPENS, "createdAt")) if (mine(event.actor)) add("reopen", event.createdAt);
    }
    for (const issue of issues) add("issue", issue.createdAt);
    // One review is one post, whatever it carries. A reply in a review thread arrives as a review.
    for (const pr of reviewed) for (const review of page(pr.reviews, REVIEWS, "submittedAt")) add("review", review.submittedAt);
    for (const thread of [...onPrs, ...onIssues]) {
      for (const comment of page(thread.comments, COMMENTS, "createdAt")) if (mine(comment.author)) add("comment", comment.createdAt);
    }
    if (discussions.length >= DISCUSSIONS && inWindow(discussions, "createdAt")) incomplete = true;
    for (const discussion of discussions) if (here(discussion)) add("discussion", discussion.createdAt);
    for (const comment of discussionComments.values()) if (here(comment.discussion)) add("discussion_comment", comment.createdAt);

    if (unreadable) return `GitHub's answer for ${repo} has a part that cannot be read.`;
    posts.sort((a, b) => b.at - a.at);
    out.set(repo, { posts: posts.slice(0, LIMITS.maxPostsStored), incomplete: incomplete || posts.length > LIMITS.maxPostsStored });
  }
  return out;
}
