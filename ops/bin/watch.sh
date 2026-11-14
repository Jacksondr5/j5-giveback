#!/usr/bin/env bash
# Watches the upstream threads of every item that is not closed, and messages the
# agent that owns an item when one of its threads has new activity.
# Run every 15 minutes by giveback-watch.timer.
#
#   watch.sh            check, send, and remember what was seen
#   watch.sh --dry-run  check and print; send nothing and remember nothing
#
# Where things come from:
#   threads     `giveback watchlist`: every link on an item that is not closed
#   recipients  `giveback agents`: each item's agent. An item with none goes to the dispatcher.
#   activity    GitHub, through `gh`
#   delivery    `j5 a2a send`, as the machine participant its token is bound to
#
# How closely a thread is watched depends on its links:
#   ours               the full check: comments, reviews, labels, PRs that reference it,
#                      review-bot verdicts and failing checks
#   theirs, base or    what people do: comments and reviews by humans, and the thread
#   covering           closing, merging or reopening
#   theirs, related    a change of state alone, read from the dashboard's own GitHub
#                      snapshot at no GitHub cost
# A thread with several links gets the closest watch any of them asks for.
#
# A thread of ours stays watched for 14 days after its item closes or drops the
# link, because a reply or a reopening often follows a close. The dashboard stops
# listing it then, so the watcher remembers it in its own state.
#
# News is put in a queue in the state file before anything is sent, and leaves the
# queue only when its message has been accepted. A message that fails is sent again
# on the next run with the same news under the same id, so it cannot arrive twice.
#
# Cheap by design: API reads only. No agent runs unless something changed.
#
# Settings, read from the environment and then from the env file scripts/giveback uses
# (~/.config/j5-giveback/env, or GIVEBACK_ENV_FILE):
#   GIVEBACK_DISPATCHER_ADDRESS  required. Where activity on an item with no agent goes.
#   J5_TOKEN_FILE                required to send. The token from `j5 a2a token issue`.
#   GIVEBACK_J5_BIN              the j5 binary. Default: j5 on PATH.
#   GIVEBACK_GITHUB_LOGIN        our own GitHub login, whose activity is not news.
#                                Default: the login gh is signed in with.
#   J5CODE_HOME, J5_ORIGIN       passed to j5 when set.
#   GIVEBACK_MAINTAINERS         free text naming the upstream maintainers, added to
#                                each message so an agent can tell whose word counts.
#   GIVEBACK_OWNER_NAME          who approves what is posted upstream, as the messages
#                                name them. Default: "the owner".
#   GIVEBACK_WATCH_LINGER_DAYS   days a thread of ours stays watched after its item
#                                closes. Default: 14.
#   GIVEBACK_WATCH_DIR           where state.json lives.
#                                Default: ~/.local/share/j5-giveback/watch
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

ENV_FILE="${GIVEBACK_ENV_FILE:-$HOME/.config/j5-giveback/env}"

# Prints one setting: the environment first, then the env file.
setting() {
  local name="$1" value="${!1:-}"
  if [ -z "$value" ] && [ -r "$ENV_FILE" ]; then
    value="$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=[[:space:]]*(.*)$/\2/p" "$ENV_FILE" | tail -n 1)"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in
      \"*\" | \'*\') value="${value:1:${#value}-2}" ;;
    esac
  fi
  printf '%s' "$value"
}

DISPATCHER="$(setting GIVEBACK_DISPATCHER_ADDRESS)"
if [ -z "$DISPATCHER" ]; then
  echo "giveback-watch: GIVEBACK_DISPATCHER_ADDRESS is not set. Set it in $ENV_FILE." >&2
  exit 2
fi

J5="$(setting GIVEBACK_J5_BIN)"
[ -n "$J5" ] || J5="$(command -v j5 || true)"
for name in J5_TOKEN_FILE J5CODE_HOME J5_ORIGIN; do
  value="$(setting "$name")"
  [ -n "$value" ] && export "$name=$value"
done
if ((!dry)); then
  if [ -z "$J5" ] || [ ! -x "$J5" ]; then
    echo "giveback-watch: cannot find the j5 binary. Set GIVEBACK_J5_BIN in $ENV_FILE." >&2
    exit 2
  fi
  if [ -z "${J5_TOKEN_FILE:-}" ] || [ ! -r "$J5_TOKEN_FILE" ]; then
    echo "giveback-watch: J5_TOKEN_FILE is not set or not readable. Set it in $ENV_FILE." >&2
    exit 2
  fi
fi

ME="$(setting GIVEBACK_GITHUB_LOGIN)"
[ -n "$ME" ] || ME="$(gh api user --jq .login)"
MAINTAINERS="$(setting GIVEBACK_MAINTAINERS)"
OWNER_NAME="$(setting GIVEBACK_OWNER_NAME)"
[ -n "$OWNER_NAME" ] || OWNER_NAME="the owner"
LINGER_DAYS="$(setting GIVEBACK_WATCH_LINGER_DAYS)"
case "$LINGER_DAYS" in
  '' | *[!0-9]*) LINGER_DAYS=14 ;;
esac

STATE_DIR="${GIVEBACK_WATCH_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/j5-giveback/watch}"
state="$STATE_DIR/state.json"
# A thread is "<owner>/<repo>#<n>" or "<owner>/<repo>/discussions/<n>".
# { "<thread>": "<ISO time up to which its activity has been read>",
#   "fail:<thread>": "<failing check names last seen>",       our PRs
#   "state:<thread>": "<state last seen on the dashboard>",
#   "linger:<thread>": { "items": [{ "item", "short", "to", "listed" }] },
#       the items a thread of ours belongs to, and when the dashboard last said so
#   "outbox": [{ "id", "item", "short", "to", "closed", "created", "summary" }] }
#       news that has been read and not yet delivered
# A missing or damaged file starts every thread from now. That loses at most the
# activity since the last good run, and never replays old activity.
oldstate='{}'
if [ -f "$state" ] && jq -e 'type == "object"' "$state" >/dev/null 2>&1; then
  oldstate="$(cat "$state")"
fi
newstate="$oldstate"
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
linger_cutoff="$(date -u -d "$LINGER_DAYS days ago" +%Y-%m-%dT%H:%M:%SZ)"
outbox_cutoff="$(date -u -d "14 days ago" +%Y-%m-%dT%H:%M:%SZ)"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Written in one move, and never as an empty file in place of a good one.
save_state() {
  jq -e 'type == "object"' <<<"$newstate" >/dev/null 2>&1 || return 1
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$newstate" >"$state.tmp" && mv "$state.tmp" "$state"
}

# Both reads fail the run when the dashboard is unreachable. Nothing is remembered
# then, so the next run covers the same period.
watchlist="$(giveback watchlist)"
agents="$(giveback agents)"
if [ "$(jq -r '.incomplete == true' <<<"$agents")" = "true" ]; then
  # An item may then look unowned when it has an agent, and its news would go to the wrong place.
  echo "giveback-watch: the list of item agents is incomplete. Nothing was checked or sent." >&2
  exit 1
fi

# One row per thread, however many links and items point at it. Each carries the
# items it belongs to: those the dashboard lists now, and those it listed within
# the linger window for a thread of ours. An item's messages go to its agent as
# recorded now. An item that is closed is no longer in the agents list, so the
# address remembered from when it was open is used.
plan="$(jq --argjson agents "$agents" --argjson old "$oldstate" --arg now "$now" --arg cutoff "$linger_cutoff" '
  def rank: if . == "full" then 2 elif . == "people" then 1 else 0 end;
  def parts: capture("^(?<repo>[^/]+/[^/#]+)(?:#(?<n>[0-9]+)|/discussions/(?<d>[0-9]+))$")
    | { repo: .repo, n: (.n // .d), discussion: (.d != null) };
  ($agents.items | map({ key: .itemSlug, value: . }) | from_entries) as $owner
  | [ .links[]
      | . as $link
      | ($link.url | capture("^https://github\\.com/(?<repo>[^/]+/[^/#?]+)/(?<type>issues|pull|discussions)/(?<n>[0-9]+)")) as $m
      | { key: (if $m.type == "discussions" then "\($m.repo)/discussions/\($m.n)" else "\($m.repo)#\($m.n)" end),
          scope: (if $link.ownership == "ours" then "full"
                  elif ($link.role == "base" or $link.role == "covering") then "people"
                  else "state" end),
          state: ($link.ghState // ""),
          item: { item: $link.itemSlug, short: ($link.itemShortId // $link.itemSlug),
                  to: ($owner[$link.itemSlug].agentAddress // ""), closed: false,
                  ours: ($link.ownership == "ours"), listed: $now } } ] as $rows
  | [ $old | to_entries[]
      | select(.key | startswith("linger:")) | select((.value | type) == "object")
      | (.key | ltrimstr("linger:")) as $key
      | (.value.listed // "") as $recorded # where the first version of this script kept the time
      | (.value.items // [])[]
      | select(type == "object") | select((.item // "") != "")
      | .listed = (.listed // $recorded)
      | select(.listed >= $cutoff)
      | . as $kept
      | select([$rows[] | select(.key == $key and .item.item == $kept.item and .item.ours)] | length == 0)
      | { key: $key, scope: "full", state: "",
          item: { item: $kept.item, short: ($kept.short // $kept.item),
                  to: (if $owner | has($kept.item) then ($owner[$kept.item].agentAddress // "") else ($kept.to // "") end),
                  closed: ($owner | has($kept.item) | not), ours: true, listed: $kept.listed } } ] as $kept
  | ($rows + $kept | group_by(.key)) as $groups
  | { threads: ($groups | map(
        (.[0].key | parts) + {
          key: .[0].key,
          scope: (map(.scope) | max_by(rank)),
          state: ((map(.state) | map(select(. != "")) | first) // ""),
          items: (map(.item) | group_by(.item) | map(sort_by(.closed) | .[0])) })),
      linger: ($groups | map(
        { key: ("linger:" + .[0].key),
          value: { items: (map(.item) | map(select(.ours)) | group_by(.item)
                           | map(sort_by(.listed) | last | { item, short, to, listed })) } }
        | select(.value.items | length > 0)) | from_entries) }
' <<<"$watchlist")"
threads="$(jq '.threads' <<<"$plan")"

# The linger records are rebuilt on every run: the listed items as of now, and the
# remembered ones that are still inside the window.
newstate="$(jq --argjson plan "$plan" 'with_entries(select(.key | startswith("linger:") | not)) + $plan.linger' <<<"$newstate")"

# ---------------------------------------------------------------------------
# GitHub checks. Each prints one line per event: "<ISO time> <what happened> <url>".
# (A change in the failing checks has no time of its own, and so prints none.)
# They run in a subshell, so each leaves what the caller needs in files under $work.
# They run in a subshell, so a failed request fails that thread alone.
# ---------------------------------------------------------------------------

# " [MEMBER]" after a login when GitHub says the author belongs to the repository.
ASSOCIATION='(if ((.author_association // "") | test("^(OWNER|MEMBER|COLLABORATOR)$")) then " [" + .author_association + "]" else "" end)'
SQUASH='gsub("<!--[^>]*-->"; "") | gsub("<[^>]*>"; "") | gsub("\\s+"; " ")'

# On our PRs the review bots matter too: Macroscope's approvability verdict gates
# upstream's deeper review, CodeRabbit can post actionable findings, and a failing
# check needs us. Bot walkthroughs and summaries are left out.
pr_bot_events() {
  local repo="$1" n="$2" since="$3" key="$4" head failing old_failing
  gh api "repos/$repo/issues/$n/comments?since=$since&per_page=100" --jq '
    .[] | select(.updated_at > "'"$since"'") | select(.user.type == "Bot")
    | select(.user.login == "macroscopeapp[bot]" or (.body | test("Actionable comments posted: [1-9]")))
    | "\(.updated_at) \(.user.login): \(.body | '"$SQUASH"' | .[0:300]) \(.html_url)"'
  gh api "repos/$repo/pulls/$n/reviews?per_page=100" --paginate --jq '
    .[] | select(.submitted_at > "'"$since"'") | select(.user.login != "'"$ME"'")
    | select(.user.type != "Bot" or .user.login == "macroscopeapp[bot]" or .user.login == "devin-ai-integration[bot]"
             or (.body | test("Actionable comments posted: [1-9]")))
    | "\(.submitted_at) review by \(.user.login)'"\\($ASSOCIATION)"': \(.state) \(.body | '"$SQUASH"' | .[0:200]) \(.html_url)"'
  gh api "repos/$repo/pulls/$n/comments?since=$since&per_page=100" --jq '
    .[] | select(.created_at > "'"$since"'") | select(.user.login != "'"$ME"'")
    | "\(.created_at) inline comment by \(.user.login)'"\\($ASSOCIATION)"' on \(.path): \(.body | '"$SQUASH"' | .[0:200]) \(.html_url)"'
  head="$(gh api "repos/$repo/pulls/$n" --jq .head.sha)"
  failing="$(gh api "repos/$repo/commits/$head/check-runs?per_page=100" --jq \
    '[.check_runs[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "action_required") | .name] | sort | join(", ")')"
  old_failing="$(jq -r --arg k "fail:$key" '.[$k] // "" | strings' <<<"$oldstate")"
  if [ -n "$failing" ] && [ "$failing" != "$old_failing" ]; then
    echo "failing checks on ${head:0:10}: $failing https://github.com/$repo/pull/$n/checks"
  fi
  printf '%s' "$failing" >"$work/fail"
}

# An issue or a PR we posted in.
thread_events() {
  local repo="$1" n="$2" since="$3" key="$4" issue
  issue="$(gh api "repos/$repo/issues/$n")"
  jq -r '.title' <<<"$issue" >"$work/title"
  gh api "repos/$repo/issues/$n/comments?since=$since&per_page=100" --jq '
    .[] | select(.created_at > "'"$since"'") | select(.user.type != "Bot" and .user.login != "'"$ME"'")
    | "\(.created_at) comment by \(.user.login)'"\\($ASSOCIATION)"': \(.body | gsub("\\s+"; " ") | .[0:200]) \(.html_url)"'
  # A reference counts only from a PR in the same repository. Forks that merge
  # upstream into themselves reference every PR in the range, and that is not news.
  gh api "repos/$repo/issues/$n/timeline?per_page=100" --paginate --jq '
    .[] | select((.created_at // .submitted_at // "") > "'"$since"'")
    | select((.actor.login // .user.login // "") != "'"$ME"'")
    | select(.event == "labeled" or .event == "unlabeled" or .event == "closed" or .event == "reopened" or .event == "merged"
             or (.event == "cross-referenced" and (.source.issue.pull_request != null)
                 and ((.source.issue.repository.full_name // "") == "'"$repo"'")))
    | select((.event != "labeled" and .event != "unlabeled") or ((.label.name // "") | test("^(vouch|size):") | not))
    | "\(.created_at // .submitted_at) \(.event) by \(.actor.login // .user.login // "?")"
      + (if .label then ": " + .label.name else "" end)
      + (if .source.issue then ": PR #" + (.source.issue.number | tostring) + " " + .source.issue.title + " " + .source.issue.html_url else "" end)'
  if [ "$(jq -r '.pull_request != null' <<<"$issue")" = "true" ]; then
    pr_bot_events "$repo" "$n" "$since" "$key"
  fi
}

# Someone else's issue or PR that one of our items waits on: what people do there.
their_thread_events() {
  local repo="$1" n="$2" since="$3" issue
  issue="$(gh api "repos/$repo/issues/$n")"
  jq -r '.title' <<<"$issue" >"$work/title"
  gh api "repos/$repo/issues/$n/comments?since=$since&per_page=100" --jq '
    .[] | select(.created_at > "'"$since"'") | select(.user.type != "Bot" and .user.login != "'"$ME"'")
    | "\(.created_at) comment by \(.user.login)'"\\($ASSOCIATION)"': \(.body | gsub("\\s+"; " ") | .[0:200]) \(.html_url)"'
  gh api "repos/$repo/issues/$n/timeline?per_page=100" --paginate --jq '
    .[] | select((.created_at // "") > "'"$since"'")
    | select(.event == "closed" or .event == "reopened" or .event == "merged")
    | "\(.created_at) \(.event) by \(.actor.login // "?")"'
  if [ "$(jq -r '.pull_request != null' <<<"$issue")" = "true" ]; then
    gh api "repos/$repo/pulls/$n/reviews?per_page=100" --paginate --jq '
      .[] | select((.submitted_at // "") > "'"$since"'") | select(.user.type != "Bot" and .user.login != "'"$ME"'")
      | "\(.submitted_at) review by \(.user.login)'"\\($ASSOCIATION)"': \(.state) \(.body | '"$SQUASH"' | .[0:200]) \(.html_url)"'
  fi
}

# Discussions are not issues: new comments and replies come through GraphQL.
discussion_events() {
  local repo="$1" n="$2" since="$3"
  gh api graphql -F n="$n" -f owner="${repo%/*}" -f name="${repo#*/}" -f query='
    query($owner: String!, $name: String!, $n: Int!) {
      repository(owner: $owner, name: $name) { discussion(number: $n) {
        title closed answer { author { login } createdAt }
        comments(last: 50) { nodes { author { login } authorAssociation createdAt url body
          replies(last: 20) { nodes { author { login } authorAssociation createdAt url body } } } } } } }' \
    >"$work/discussion.json"
  jq -r '.data.repository.discussion.title' "$work/discussion.json" >"$work/title"
  jq -r --arg since "$since" --arg me "$ME" '
    .data.repository.discussion as $d
    | ([$d.comments.nodes[] | ., .replies.nodes[]]
       | .[] | select(.createdAt > $since) | select((.author.login // "") != $me)
       | "\(.createdAt) comment by \(.author.login // "?")"
         + (if ((.authorAssociation // "") | test("^(OWNER|MEMBER|COLLABORATOR)$")) then " [" + .authorAssociation + "]" else "" end)
         + ": \(.body | gsub("\\s+"; " ") | .[0:200]) \(.url)"),
      (if $d.answer and $d.answer.createdAt > $since then "\($d.answer.createdAt) marked answered" else empty end)
  ' "$work/discussion.json"
}

# ---------------------------------------------------------------------------
# Check every thread once.
# ---------------------------------------------------------------------------

declare -A events_of title_of url_of
check_failed=0

set_state() { newstate="$(jq --arg k "$1" --arg v "$2" '.[$k] = $v' <<<"$newstate")"; }

# The lists are read on descriptor 3, so nothing inside a loop can swallow them from standard input.
while IFS=$'\t' read -r -u 3 key repo n discussion scope ghstate; do
  if [ "$discussion" = "true" ]; then
    url_of[$key]="https://github.com/$repo/discussions/$n"
  else
    url_of[$key]="https://github.com/$repo/issues/$n"
  fi

  # Both marks are kept for every thread, whatever its level, so a thread that
  # moves between levels neither repeats old news nor skips what came in between.
  since="$(jq -r --arg k "$key" '.[$k] // "" | strings' <<<"$oldstate")"
  [ -n "$since" ] || since="$now" # first sight: start watching from now
  previous="$(jq -r --arg k "state:$key" '.[$k] // "" | strings' <<<"$oldstate")"

  if [ "$scope" = "state" ]; then
    # Only a change of state is news, and the dashboard already knows the state.
    [ "$ghstate" = "-" ] || set_state "state:$key" "$ghstate"
    if [ "$ghstate" != "-" ] && [ -n "$previous" ] && [ "$previous" != "$ghstate" ]; then
      events_of[$key]="state changed from $previous to $ghstate"
      if [ "$discussion" != "true" ]; then
        title_of[$key]="$(gh api "repos/$repo/issues/$n" --jq .title 2>/dev/null || true)"
      fi
    fi
    set_state "$key" "$now"
    continue
  fi

  # Saved before the check, so a thread whose first check fails is still read from this moment.
  set_state "$key" "$since"
  rm -f "$work/title" "$work/fail"
  # Not in an "if" or "||": errexit is switched off inside those, and a failed
  # request has to stop this thread's check.
  set +e
  (
    set -e
    if [ "$discussion" = "true" ]; then
      discussion_events "$repo" "$n" "$since"
    elif [ "$scope" = "full" ]; then
      thread_events "$repo" "$n" "$since" "$key"
    else
      their_thread_events "$repo" "$n" "$since"
    fi
  ) >"$work/events" 2>"$work/error"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    # The mark stays where it was, so the next run reads this period again.
    echo "giveback-watch: could not check $key: $(tr '\n' ' ' <"$work/error" | cut -c1-300)" >&2
    check_failed=1
    continue
  fi
  found="$(sed '/^$/d' "$work/events" | sort)"
  if [ -n "$found" ]; then
    events_of[$key]="$found"
    title_of[$key]="$(cat "$work/title" 2>/dev/null || true)"
  fi
  set_state "$key" "$now"
  # Only now, with the thread's own events read: a close that this check would
  # have reported must not be marked as seen when the check failed.
  [ "$ghstate" = "-" ] || set_state "state:$key" "$ghstate"
  [ -f "$work/fail" ] && set_state "fail:$key" "$(cat "$work/fail")"
done 3< <(jq -r '.[] | [.key, .repo, .n, (.discussion | tostring), .scope, (if .state == "" then "-" else .state end)] | @tsv' <<<"$threads")

# ---------------------------------------------------------------------------
# Queue one message per item that has news.
# ---------------------------------------------------------------------------

# Whatever was read above is now past its thread's mark, so it has to reach the
# queue in the same save. From here on a message is lost only if it is delivered.
newstate="$(jq --arg cutoff "$outbox_cutoff" '.outbox = [(.outbox // [])[] | select(type == "object") | select((.created // "") >= $cutoff)]' <<<"$newstate")"
dropped="$(jq -r --arg cutoff "$outbox_cutoff" '[(.outbox // [])[] | select(type == "object") | select((.created // "") < $cutoff)] | length' <<<"$oldstate")"
if [ "$dropped" != "0" ]; then
  echo "giveback-watch: gave up on $dropped message(s) that could not be delivered for 14 days." >&2
fi

while IFS=$'\t' read -r -u 3 slug short to closed keys; do
  summary=""
  for key in $keys; do
    [ -n "${events_of[$key]:-}" ] || continue
    summary+="$key"
    [ -n "${title_of[$key]:-}" ] && summary+=" (${title_of[$key]})"
    summary+=" ${url_of[$key]}"$'\n'"$(sed 's/^/- /' <<<"${events_of[$key]}")"$'\n\n'
  done
  [ -n "$summary" ] || continue
  [ "$to" != "-" ] || to=""
  # The time is part of the id: the same words can be news twice, as when a
  # thread closes, reopens and closes again.
  id="giveback-watch-$(printf '%s\n%s\n%s' "$slug" "$now" "$summary" | sha256sum | cut -c1-16)"
  newstate="$(jq --arg id "$id" --arg item "$slug" --arg short "$short" --arg to "$to" --arg closed "$closed" \
    --arg created "$now" --arg summary "$summary" \
    '.outbox += [{ id: $id, item: $item, short: $short, to: $to, closed: ($closed == "true"), created: $created, summary: $summary }]' <<<"$newstate")"
done 3< <(jq -r '
  [.[] | .key as $key | .items[] | . + { key: $key }]
  | group_by(.item)[]
  | [.[0].item, .[0].short, (if .[0].to == "" then "-" else .[0].to end), (all(.closed) | tostring), (map(.key) | join(" "))]
  | @tsv' <<<"$threads")

# A message waiting from an earlier run goes to the item's agent as recorded now.
newstate="$(jq --argjson agents "$agents" '
  ($agents.items | map({ key: .itemSlug, value: . }) | from_entries) as $owner
  | .outbox |= map(.item as $slug
      | if $owner | has($slug) then .to = ($owner[$slug].agentAddress // "") | .closed = false else . end)
' <<<"$newstate")"

pending="$(jq '.outbox | length' <<<"$newstate")"
if ((dry)); then
  for ((i = 0; i < pending; i++)); do
    jq -r --argjson i "$i" --arg dispatcher "$DISPATCHER" '.outbox[$i]
      | "== \(.short) -> \(if .to == "" then $dispatcher + " (the dispatcher: no recorded agent)" else .to end)"
        + (if .closed then " [item closed]" else "" end) + "\n" + .summary' <<<"$newstate"
  done
  exit "$check_failed"
fi

save_state

# ---------------------------------------------------------------------------
# Deliver the queue.
# ---------------------------------------------------------------------------

deliver() { # deliver <to> <client request id>, with the message on standard input
  "$J5" a2a send --to "$1" --client-request-id "$2" --message - >/dev/null
}

send_failed=0
queue="$(jq '.outbox' <<<"$newstate")" # a copy: entries leave the state as they are delivered
for ((i = 0; i < pending; i++)); do
  entry="$(jq --argjson i "$i" '.[$i]' <<<"$queue")"
  id="$(jq -r '.id' <<<"$entry")"
  short="$(jq -r '.short' <<<"$entry")"
  to="$(jq -r '.to' <<<"$entry")"
  summary="$(jq -r '.summary' <<<"$entry")"

  note=""
  if [ "$(jq -r '.closed' <<<"$entry")" = "true" ]; then
    note+="$short is closed. A thread of ours stays watched for $LINGER_DAYS days after that."$'\n\n'
  fi
  if [ -z "$to" ]; then
    to="$DISPATCHER"
    note+="$short has no recorded agent, so this comes to the dispatcher."$'\n\n'
  fi
  body="new upstream activity on $short.

$note$summary
Read the activity in full, and the item with \`giveback show $short\`. Then handle it as step 6 of contributing.md in the t3code-giveback skill says. A login marked [MEMBER], [OWNER] or [COLLABORATOR] belongs to the upstream repository.${MAINTAINERS:+ Maintainers: $MAINTAINERS.} Post nothing upstream that $OWNER_NAME has not approved. If the activity needs nothing from us, do nothing and reply to no one."

  printf '== %s -> %s\n%s' "$short" "$to" "$summary"
  status=0
  deliver "$to" "$id" <<<"Giveback watcher: $body" || status=$?
  if [ "$status" -ne 0 ] && [ "$status" -ne 6 ] && [ "$to" != "$DISPATCHER" ]; then
    # Exit 6 is the J5 server not answering. Anything else means this agent cannot
    # be reached, so the dispatcher takes it.
    echo "giveback-watch: could not reach the agent of $short (exit $status). Sending to the dispatcher." >&2
    status=0
    deliver "$DISPATCHER" "$id-d" <<<"Giveback watcher: the recorded agent of $short could not be reached, so this comes to the dispatcher. Original message: $body" || status=$?
  fi
  if [ "$status" -ne 0 ]; then
    echo "giveback-watch: could not deliver the activity on $short (exit $status). It stays queued." >&2
    send_failed=1
    continue
  fi
  # Saved after each one, so a run that dies here does not send this message again.
  newstate="$(jq --arg id "$id" '.outbox |= map(select(.id != $id))' <<<"$newstate")"
  save_state
done

if ((check_failed || send_failed)); then exit 1; fi
