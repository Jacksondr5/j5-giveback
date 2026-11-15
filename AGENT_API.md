# Giveback dashboard: agent API

This file is for an agent that has to record or read giveback state and has never seen this project.

The giveback dashboard tracks every item that Jackson's fork, J5 Code, gives back to an upstream repository (mainly `pingdotgg/t3code`). It is the source of truth for that state. The site is read-only for people. Agents write to it over HTTP, and read it back over HTTP.

- [Quick start](#quick-start)
- [The model](#the-model)
- [Item IDs](#item-ids)
- [Upstream's PR rules](#upstreams-pr-rules)
- [Privacy rules](#privacy-rules)
- [Endpoints](#endpoints)
- [Enumerations](#enumerations)
- [Limits](#limits)
- [Errors](#errors)

## Quick start

Use the `scripts/giveback` command. It needs Node 18 or newer and nothing else.

Configuration comes from environment variables, or from a file of `KEY=VALUE` lines. The script never takes the URL or a secret as an argument. Do not paste a secret into a chat, a commit, or a command line.

| Name | Meaning |
|---|---|
| `GIVEBACK_URL` | Base URL of the site, such as `https://j5-giveback.lakebed.app` |
| `GIVEBACK_AGENT_SECRET` | Bearer secret for every command except `refresh` |
| `GIVEBACK_REFRESH_SECRET` | Bearer secret for `refresh` |
| `GIVEBACK_DISPATCHER_ADDRESS` | Optional. The address of the dispatcher agent, which takes items that have no agent. `agents` prints it. |
| `GIVEBACK_ENV_FILE` | Path of the file. Default: `~/.config/j5-giveback/env` |

```sh
# Record a finding, or change an item. An omitted field keeps its value.
scripts/giveback upsert item.json
echo '{"slug":"my-item","stage":"offered","waitingOn":"maintainer"}' | scripts/giveback upsert -

# Ask Jackson for something, and close the ask when he has answered.
scripts/giveback ask open --key t3code-33420:text --item my-item --kind text_approval \
  --label "Approve the PR description" --recommendation "Approve as written"
scripts/giveback ask close --key t3code-33420:text --resolution "Approved"

# Add a line to an item's history.
scripts/giveback event add --key t3code-33420:posted --item my-item --actor agent --type posted \
  --note "Opened pingdotgg/t3code#33420." --url https://github.com/pingdotgg/t3code/pull/33420 --public

# Remove events recorded by mistake, the server's own "auto:" events included.
scripts/giveback event delete --key t3code-33420:posted --key auto:stage:44db62bf-98be-40ea-9a83-2019e8d39331:1794414478790

# Set one link's triage fields without resending the item's other links.
scripts/giveback link triage --url https://github.com/pingdotgg/t3code/pull/33420 --bucket "needs approval" --rank 12

# Read one item, by its ID or its slug: links, asks, events and private fields.
scripts/giveback show GB-12

# Read everything back.
scripts/giveback export --out backup.json

# List the upstream threads worth polling: every link on an item that is not closed.
scripts/giveback watchlist

# See whether a PR slot is free, and which item is next for one.
scripts/giveback capacity

# Refresh GitHub state for every link on an open item, and read our account's posts for the post count.
scripts/giveback refresh
```

`upsert`, `ask apply`, `event apply`, `event delete`, `link apply` and `load` split a large file into batches for you.

## The model

An **item** is one thing given back, or considered for it. It has one **stage**, one **waiting on**, and, when closed, one **outcome**.

| Stage | Meaning | Who moves it on |
|---|---|---|
| `found` | A candidate was recorded | Giveback agent |
| `validating` | Being checked against current upstream `main` and searched for duplicates | Giveback agent |
| `deciding` | Validated and real. Needs a route. | Jackson |
| `held` | Valid, with nothing to offer yet. Waiting on someone else's upstream change, or on a free PR slot. | Upstream |
| `preparing` | Route chosen. Branch, tests, evidence and post text are being produced. | Giveback agent |
| `approving` | The exact text of the upstream post is ready | Jackson |
| `offered` | Posted upstream and being babysat | Upstream |
| `closed` | Has an outcome | |

An item can move backwards. The agent sets the stage; the server records each change in the item's history.

`held` is a side stop, not a step on the path. Use it for a valid candidate that cannot be offered yet because someone else's open upstream PR covers it, because a dependency has to land first, or because our PR slots are all in use. Do not leave such an item in `validating` (which says the agent is still checking) or `deciding` (which says Jackson owes a decision). Give it:

- `waitingOn`: `covering_pr`, `base_pr`, `pr_slot`, or whatever it really waits on. Not `jackson`.
- a link with role `covering` or `base` to the thread it waits on. The site shows that link with its live state in the "Held" section of the overview, and the refresh keeps reading it, because a held item is not closed. **Waiting for a PR slot is the one case that needs no such link**: the item waits on our own open PRs, and the site shows it in the queue for a slot. See [Upstream's PR rules](#upstreams-pr-rules).
- `route`, if one was chosen before the item was held. The item's page marks Deciding as passed only when a route is recorded.

When that thread merges or closes, the refresh raises the item's "state changed upstream" marker (see [refresh](#post-apirefresh)). Move the item then: to `closed` with an outcome such as `covered_by_contributor`, or back onto the path.

An item has:

- **An ID**, such as `GB-12`: its short name. See [Item IDs](#item-ids).
- **Links**: the upstream PRs, issues, comments and discussions it concerns. The server copies GitHub state onto each link (see [refresh](#post-apirefresh)).
- **Asks**: things that need Jackson. An ask is opened and closed by an agent, and has an age.
- **Events**: its history.
- **Private fields**: notes that only the owner sees.

## Item IDs

Every item has a short ID: `GB-<n>`, such as `GB-12`. GB is for give-back. It is the name Jackson uses for an item: "what's the status of GB-12?".

- **The server assigns it.** Each new item takes the next number, starting at 1. Items created in one request are numbered in the order they appear in it. The response to [`POST /api/agent/items`](#post-apiagentitems) carries each item's `number` (12) and `shortId` (`"GB-12"`).
- **It never changes.** An upsert never changes an item's number, and a `number` in a request is rejected as an unknown field. Moving stages, closing, and changing `isPublic` all leave it alone.
- **It is never reused.** Deleting an item does not free its number. Deleting an item and creating it again, which is how a slug is renamed, gives it a new ID.
- **It is public, for every item.** An undisclosed item shows its ID and nothing else new: a bare number says nothing about the item. So `GB-12` is safe to write anywhere, and it is the only public name an undisclosed item has. The slug of an undisclosed item stays private.
- **It is not the slug.** The API still identifies an item by `slug` in every request. The ID is for reading and for talking. `scripts/giveback show GB-12` gives the slug.

**Name an item to Jackson by its ID and its title together**: "GB-12, the Merge back tooltip", not the ID alone and not the slug. The ID is what he can say back; the title is what tells him which item it is without looking it up. For an undisclosed item, use the ID with its real title only where the owner alone reads it.

To read one item:

```sh
scripts/giveback show GB-12            # or: scripts/giveback show gb-12, scripts/giveback show <slug>
```

It prints the item with its `shortId`, `links`, `asks` (each with its `private`), `events` and `private` fields, in the same shape as one entry of `scripts/giveback export`. It exits 1 when no item has that ID or slug. It reads the full export and picks the item out, so it costs one read of everything.

On the site, `/items/GB-12` is the item's page (`/items/gb-12` works too), the item list's search finds `GB-12`, and the ID is shown before the title wherever an item is named.

A slug must not have the form of an ID. Creating an item with the slug `gb-12` is refused.

## Upstream's PR rules

`pingdotgg/t3code` enforces its contribution rules with a bot. The dashboard knows them, in `shared/upstreamRules.ts`, keyed by repository. `pingdotgg/t3code` is the only repository in that map; a repository outside it has no slots and no clocks.

| Rule | Value for `pingdotgg/t3code` |
|---|---|
| Open PRs a contributor may have | 3. A fourth is closed as it opens. |
| A PR labelled `needs-rebase` | Closed once 7 days have passed since its last activity, while it still conflicts. Any activity (a push, a comment, a review, a label) restarts the 7 days. |
| A PR labelled `triage:closing` | Closed 72 hours after the label was applied. If anything happened on the PR more than 15 seconds after the label, the next sweep removes the label instead: the PR is back for another look. |
| A PR labelled `triage:keep-open` | Exempt from both. |
| The bot's sweep | Once a day, at 05:23 UTC. A close happens at the first sweep after its deadline. |

### PR slots

Each of our open PRs in such a repository fills one **slot**: a link with kind `pr` and ownership `ours`, on an item that is not closed, that is `open` on GitHub or has not been read by the refresh yet. One PR fills one slot even when it sits on two items. A PR on a closed item does not count, because the refresh no longer reads it: close an item only when its PR is really finished.

An item whose text is ready, and which cannot be posted because the slots are all in use, **waits for a slot**:

```json
{ "items": [{ "slug": "my-item", "stage": "held", "waitingOn": "pr_slot", "queueRank": 2 }] }
```

- `stage`: `held`. `waitingOn`: `pr_slot`. No `covering` or `base` link is needed.
- `queueRank` is the item's place in the queue: a whole number from 1 to 999, and the lower goes first. The dispatcher agent sets it. Items with no rank go after every ranked item, and equal ranks go longest-waiting first (`waitingSince`).
- The server clears `queueRank` when an upsert sets `waitingOn` to anything other than `pr_slot`, or closes the item. So to take an item out of the queue, change what it waits on; there is nothing else to tidy.

The queue shows, for each item, whether its text is approved. That is **derived, not stored**: the server looks at the item's newest `text_approval` ask, the one with the latest `openedAt`.

| The newest `text_approval` ask is | The queue says | `text` |
|---|---|---|
| closed | Text approved | `approved` |
| open | Text awaits approval | `awaiting` |
| absent: the item has no such ask | No text yet | `none` |

So record an approval the way [text approved in advance](#text-approved-in-advance-for-a-conditional-post) describes: open a `text_approval` ask and close it when Jackson has approved. To put a new text to him, open a new ask under a new key; it becomes the newest, and the item reads "awaits approval" until it is closed. The server reads an item's 20 most recently created asks for this, and does so for the first 10 queued items; past those, `text` is `null`.

The site's overview shows the slots and the queue to everyone. [`GET /api/agent/capacity`](#get-apiagentcapacity) returns the same, with nothing withheld, for the dispatcher.

### Closing clocks

The refresh reads each PR's labels, its "updated" time, and when `triage:closing` was last applied. From those the site shows a clock on every open PR of ours that upstream's bot is going to close:

| The PR carries | The site says |
|---|---|
| `triage:keep-open` | Nothing. No clock runs. |
| `triage:closing`, and nothing happened on it after the notice | "Closes in 41 h unless answered": 72 hours from the notice |
| `triage:closing`, and something happened more than 15 seconds after the notice | "Notice answered, back for another look" |
| `needs-rebase` (and not `triage:closing`), on a PR that also carries `vouch:unvouched` and that GitHub does not report as mergeable | "Closes after 21 Nov unless rebased": 7 days from the PR's last activity. On any other PR the bot takes `needs-rebase` off at its next sweep, so no clock is shown. |
| either, past its deadline | "Due to close at the next daily sweep" |

The closing notice outranks the rebase request, as it does in upstream's bot. When the refresh first sees either label on one of our open PRs, it raises the item's "state changed upstream" marker: see [refresh](#post-apirefresh). A closing notice that was lifted and given again raises it again.

### Takeover pipeline

Since about 2026-11-13, `pingdotgg/t3code` lands most outside PRs through an automated "takeover" pipeline that runs under a maintainer's account. It merges `main` into the contributor's branch, may add commits, reviews, and captures evidence. **This was observed on 2026-11-15. Nothing in upstream's repository defines it, and it is expected to change.** The labels on the PR are the source of truth: when the site and the PR disagree, believe the PR.

The pipeline's state is the PR's label that starts with `takeover:`. A PR carries one at a time.

| Label | Meaning |
|---|---|
| `takeover:in-progress` | The pipeline is working on the PR, for about half an hour. |
| `takeover:ready` | The pipeline passed it. It is merged within about a minute. |
| `takeover:needs-julius` | It waits on a maintainer's decision, usually with no comment. |
| `takeover:blocked` | The pipeline stopped and left the PR open. |
| any other `takeover:` label | Not known here. |

**The site shows the label exactly as GitHub has it**, with no wording of its own, in every list and on the item's page. For `takeover:blocked` it adds the reason from the pipeline's last comment marker when it read one: `takeover:blocked (no-bug-on-base)`. An unknown `takeover:` label is shown the same way.

**While a PR carries `takeover:in-progress` or `takeover:ready`, push nothing to its branch.** A push by anyone else stops the pipeline. The site draws those two labels outlined and bold; it does not say why. The rule is yours to follow.

When the pipeline stops or closes a PR, it comments, and the comment ends with a marker: `<!-- factory:stopped-no-bug-on-base -->`. Values seen or reported: `stopped-moved`, `stopped-no-bug-on-base`, `stopped-cannot-prove`, `stopped-not-proven`, `stopped-reviews`, and for a closure `absent`, `redundant`, `duplicate`, `stacked`, `replaced`. The list is open; others appear. The refresh stores the newest marker on the link as `ghPipelineMarker`, with its comment's time as `ghPipelineMarkerAt`. It stores the value only, never the comment's text, and only a value of at most 60 characters from `a-z`, `0-9` and `-`. Anyone can type the marker into a comment, so only a comment whose author GitHub reports as `OWNER`, `MEMBER` or `COLLABORATOR` of the repository sets it.

For `takeover:blocked`, a marker that starts with `stopped-` is the reason, shown with the prefix dropped and nothing else changed: `no-bug-on-base`. A marker counts only for the pipeline run it was written about: one older than the PR's present `takeover:` label is set aside, and a stored one is dropped when the label changes. When the reason cannot be attributed, the label is shown alone.

Only an open PR of ours (kind `pr`, ownership `ours`) in a repository with rules has a pipeline state. When the refresh sees a `takeover:` label on one that is new or different from the stored one, it records a `pipeline_state` event and raises the item's "state changed upstream" marker: see [refresh](#post-apirefresh). [`GET /api/agent/capacity`](#get-apiagentcapacity) gives each slot's state as `takeover`.

Every name above is in one place, `takeover` in `shared/upstreamRules.ts`: the label prefix, the known states, which of them forbid a push and which are a stop, the marker's name, and the prefix of a stop. Revise it there.

### Bug, behaviour change or feature

Upstream's test: a PR must fix a bug, and a change to how the product behaves is a feature, even when the PR calls it a fix. Record the verdict on the item as `changeKind`: `bug`, `behaviour_change` or `feature`. See [change kind](#change-kind). The site shows it on the item's page and in every list.

## Privacy rules

The site is public. Read these before writing.

1. **`isPublic` decides whether anyone but the owner sees an item.** When it is `false`, the public sees an "Undisclosed candidate" with only its [ID](#item-ids), its stage, what it waits on, and its dates. No title, summary, slug, route, kind of change, links, events or asks. Two things follow from what it waits on and are public too: an undisclosed item that waits for a [PR slot](#pr-slots) is listed in the queue by its ID and its position, with nothing about its text and without its `queueRank`; and an undisclosed item whose open PR is ours shows as a filled slot, by its ID, with nothing about the PR. Its asks are not shown to visitors at all, in the "Needs Jackson" queue or on the item's page, and they do not count in the public "open asks" number. The owner sees and counts them. Set `isPublic: false` for anything security-sensitive until it is filed upstream. `isPublic` is required when you create an item. There is no default.
2. **Public fields are public.** For a public item, everything outside `private` is shown to everyone: title, summary, route reason, validation verdict, follow-up note, kind of change, queue rank, links, ask labels and resolutions, and events with `isPublic: true`.
3. **Private fields are for the owner only.** `private.notes`, `private.impact`, `private.preparedBranch`, `private.agentName`, `private.agentAddress` on an item; `private.recommendation`, `private.draftPointer` on an ask; and events with `isPublic: false`.
4. **Never send these, in any field, public or private**: local paths, host names, ports, thread ids, token locations, or commentary about maintainers. The one exception is `private.agentAddress`, which exists to hold the address of the item's owning agent (see `GET /api/agent/item-agents`). The server rejects any string that contains `/home/`, `/tmp/`, `/mnt/`, `/Users/`, `/root/` or `~/`. It cannot detect the rest. That is your job.
5. **Keys are private.** Ask keys and event keys are never shown publicly, so a key may name its subject.
6. **Write for a stranger.** A summary is one or two plain sentences that someone outside the project can read.

## Endpoints

Every request carries `Authorization: Bearer <secret>`. The agent endpoints take `AGENT_SECRET`. The two refresh endpoints take `REFRESH_SECRET`. Request and response bodies are JSON.

Times in a request are either epoch **milliseconds** or an ISO 8601 string such as `"2026-11-09T15:38:46Z"`. Times in a response are epoch milliseconds. The site shows dates in the reader's own time zone, so for a date with no time of day send midday UTC (`"2026-10-30T12:00:00Z"`): midnight UTC shows as the day before in the Americas.

Each write request is one transaction. If anything in it is invalid, the response is `400` with a list of errors and **nothing is applied**.

### `POST /api/agent/items`

Creates or changes up to 25 items, carrying at most 200 links between them. `slug` identifies an item.

- **To create**: send `slug`, `title`, `summary`, `stage`, `waitingOn`, `targetRepo` and `isPublic`. The server gives the item the next number; see [Item IDs](#item-ids). Do not send one.
- **To change**: send `slug` and the fields that change. An omitted field keeps its value. `null` clears an optional field.
- **`links`**, when present, replaces the item's whole link set. A link is identified by its `url`; a link that stays keeps its GitHub snapshot. Omit `links` to leave them alone. To change only a link's triage fields, use [`POST /api/agent/links`](#post-apiagentlinks) instead.
- **`private`**, when present, is merged field by field into the item's private fields.
- Sending the same request twice changes nothing the second time.

The server does these on its own:

- Records a `stage_changed` event when the stage or the outcome changes, and when an item is created. `stageNote` sets its text and `stageEventAt` sets its time. Without `stageEventAt` the event is stamped with the time of the request, so send it when you record something that happened earlier, such as an item found in September and entered today.
- Sets `waitingSince` to now when `waitingOn` changes, unless you send `waitingSince`.
- Sets `closedAt` to now when the stage becomes `closed`, unless you send `closedAt`.
- Clears `outcome` and `closedAt` when an item leaves `closed`.
- Clears `queueRank` when `waitingOn` becomes anything other than `pr_slot`, and when the item closes.

Full example:

```json
{
  "items": [
    {
      "slug": "agent-stop-attribution",
      "title": "An agent's Stop no longer reads as the user's",
      "summary": "Agent-initiated stops now name the agent in the timeline, including delegated tasks.",
      "stage": "offered",
      "route": "direct_pr",
      "routeReason": "Small fix with a test. CONTRIBUTING allows a direct PR for that.",
      "waitingOn": "maintainer",
      "waitingSince": "2026-11-09T15:40:00Z",
      "outcome": null,
      "targetRepo": "pingdotgg/t3code",
      "originRefs": ["Jacksondr5/j5code#2810"],
      "foundAt": "2026-11-02T10:00:00Z",
      "lastValidatedAt": "2026-11-09T14:00:00Z",
      "lastValidatedSha": "37b3be30ae7e",
      "validationVerdict": "Valid. Reproduces on upstream main. No duplicate found.",
      "followUpState": "none",
      "followUpNote": null,
      "isPublic": true,
      "changeKind": "bug",
      "stageNote": "Opened pingdotgg/t3code#33420.",
      "links": [
        {
          "url": "https://github.com/pingdotgg/t3code/pull/33420",
          "repo": "pingdotgg/t3code",
          "number": 33420,
          "kind": "pr",
          "ownership": "ours",
          "role": "primary",
          "triageBucket": "needs approval",
          "triageRank": 12
        }
      ],
      "private": {
        "notes": "A maintainer verified it on Linux.",
        "impact": "Drops one fork patch at the next advance.",
        "preparedBranch": "giveback/agent-stop-attribution"
      }
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `slug` | string | Required. 3 to 64 characters: lowercase letters, digits, hyphens. It appears in the public URL of a public item. It cannot be changed later. It must not have the form of an item ID (`gb-12`). |
| `title` | string | Up to 120 characters |
| `summary` | string | Up to 300 characters |
| `stage` | [stage](#stage) | |
| `route` | [route](#route) or null | Chosen at `deciding` |
| `routeReason` | string or null | Up to 300. The CONTRIBUTING justification. |
| `waitingOn` | [waiting on](#waiting-on) | |
| `waitingSince` | time | |
| `outcome` | [outcome](#outcome) or null | Required when `stage` is `closed`. Not allowed otherwise. |
| `closedAt` | time or null | Allowed only when `stage` is `closed` |
| `targetRepo` | string | `owner/name` |
| `originRefs` | string[] | Up to 10 J5 refs, each up to 200 characters. Replaces the list. |
| `foundAt` | time | Defaults to now on create |
| `lastValidatedAt` | time or null | |
| `lastValidatedSha` | string or null | 7 to 40 lowercase hex characters: the upstream commit validated against |
| `validationVerdict` | string or null | Up to 200 |
| `followUpState` | [follow-up state](#follow-up-state) | The fork patch still to be dropped after a closed outcome |
| `followUpNote` | string or null | Up to 300 |
| `isPublic` | boolean | Required on create |
| `queueRank` | number or null | The item's place in the queue for a [PR slot](#pr-slots): a whole number from 1 to 999, lower first. Anything else is refused: "Must be a whole number from 1 to 999, or null." Allowed only while `waitingOn` is `pr_slot` and the item is not closed; a number sent otherwise is refused: "Allowed only when waitingOn is "pr_slot" and the item is not closed." `null` clears it, and is always accepted. Public for a public item. |
| `changeKind` | [change kind](#change-kind) or null | The verdict under upstream's test. `null` clears it. Any other value is refused: "Must be one of: bug, behaviour_change, feature." Public for a public item. |
| `stageNote` | string | Up to 280. Public text for the stage-change event this request causes. Ignored when it causes none. |
| `stageEventAt` | time | When the stage change happened: the time of the `stage_changed` event this request causes. Defaults to now. Must be a valid time not later than the server's clock; anything else is refused with a 400 whether or not an event is recorded. A valid value has no effect when the request causes no such event. It applies to this request only and is not stored on the item. |
| `clearUpstreamChange` | boolean | `true` clears the "state changed upstream" marker (see refresh) |
| `links` | link[] | Up to 20. At most one with role `primary`. |
| `private` | object | `notes` (up to 2,000, may have line breaks), `impact` (up to 2,000), `preparedBranch` (up to 200), `agentName` (up to 120), `agentAddress` (up to 200, no spaces). Each may be null to clear it. |

Link fields:

| Field | Type | Notes |
|---|---|---|
| `url` | string | Required. Must start with `https://github.com/<repo>/`. The link's identity: see below. |
| `repo` | string | Required. `owner/name`. |
| `number` | number | Required. The PR, issue or discussion number. For a comment, the number of the thread it is on. |
| `kind` | [link kind](#link-kind) | Required |
| `ownership` | [link ownership](#link-ownership) | Required. `ours` if Jackson's account opened it. |
| `role` | [link role](#link-role) | Required |
| `triageBucket` | string or null | Up to 40. The T3 triage board's bucket. Only agents set it; see [refresh](#post-apirefresh) and [`POST /api/agent/links`](#post-apiagentlinks). |
| `triageRank` | number or null | Positive whole number. It may be null while `triageBucket` is set: a bucket with no rank is valid. |

**Links are keyed by `url`.** Within one item, two links cannot share a URL. So a link to an issue and a link to our comment on that issue need different URLs: give the comment link the comment's own URL, the one that ends in `#issuecomment-…`, and give both the issue's `number`.

```json
"links": [
  { "url": "https://github.com/pingdotgg/t3code/issues/34401", "repo": "pingdotgg/t3code", "number": 34401, "kind": "issue", "ownership": "theirs", "role": "related" },
  { "url": "https://github.com/pingdotgg/t3code/issues/34401#issuecomment-2471", "repo": "pingdotgg/t3code", "number": 34401, "kind": "comment", "ownership": "ours", "role": "primary" }
]
```

The refresh does not read a comment. For every link it reads the thread that `repo` and `number` name, so a comment link shows the state, labels and activity of the issue, PR or discussion it sits on.

The same URL may appear on more than one item. Each item has its own copy of the link.

Unknown fields are rejected, so a misspelled `isPublic` cannot silently publish an item.

Response:

```json
{
  "ok": true,
  "results": [
    { "slug": "agent-stop-attribution", "id": "44db62bf-98be-40ea-9a83-2019e8d39331", "number": 12, "shortId": "GB-12", "status": "created", "stageEvent": true }
  ]
}
```

`status` is `created`, `updated` or `unchanged`. `id` is the row id. `number` and `shortId` are the item's [ID](#item-ids); they are `null` only for an item stored before IDs existed that the [backfill](#post-apiagentitemsassign-numbers) has not numbered yet.

### `POST /api/agent/items/assign-numbers`

Gives a number to every item that has none. It exists for the items stored before IDs did; a new item gets its number when it is created, so this is run once after the deploy that adds IDs, and is harmless to run again.

- Items are numbered oldest find first: by `foundAt`, and by creation time where two share a `foundAt`. Numbering continues after the highest number in use.
- An item that has a number keeps it. When every item has one, the call assigns nothing and writes nothing.
- The body is optional. `{"limit": 50}` sets how many items one call may number: 1 to 350, default 100. One call is one transaction, and Lakebed cancels a transaction after 5 seconds, so the default is well under what the write limit (1,000 rows) would allow.
- **It is resumable.** The response says how many items are still without a number in `remaining`. Call again until it is 0. The order does not depend on where a call stops, so several calls give the same numbers as one. A call that fails assigns nothing.

```json
{
  "ok": true,
  "assigned": [
    { "slug": "merged-device-hub-fix", "id": "1b66cba8-a899-485b-861e-570ab3b54253", "number": 1, "shortId": "GB-1" },
    { "slug": "agent-stop-attribution", "id": "44db62bf-98be-40ea-9a83-2019e8d39331", "number": 2, "shortId": "GB-2" }
  ],
  "remaining": 0,
  "nextNumber": 3
}
```

`nextNumber` is the number the next new item will get.

With the script: `scripts/giveback assign-numbers`, which calls until nothing remains and prints every pair it assigned. `--limit N` sets the items per call.

### `POST /api/agent/items/delete`

Removes one item together with its links, asks, events and private fields. Use it only to undo a mistake, such as a wrong slug or a duplicate. An item that ran its course is closed with an outcome, never deleted, because its history is the record.

```json
{ "slug": "merge-back-tooltip", "confirm": "merge-back-tooltip" }
```

`confirm` must repeat the slug. The response is `{"ok": true, "deleted": {"slug": "...", "links": 2, "asks": 1, "events": 5}}`. An unknown slug returns 404. An item with more than 45 asks or 800 events returns 409 and is not deleted. To rename a slug, export the item, delete it, and upsert it under the new slug with its asks and events. The item created that way gets a new [ID](#item-ids): the deleted item's number is not used again.

With the script: `scripts/giveback delete merge-back-tooltip`.

### `POST /api/agent/asks`

Opens and closes up to 30 asks. `key` is a stable name you choose, 3 to 80 characters of letters, digits and `. _ : # -`. A retry with the same key does not make a second ask.

```json
{
  "asks": [
    {
      "op": "open",
      "key": "t3code-33420:maintainer-question",
      "item": "agent-stop-attribution",
      "kind": "maintainer_question",
      "publicLabel": "A maintainer asked whether delegated stops should name the parent",
      "openedAt": "2026-11-10T12:45:00Z",
      "private": {
        "recommendation": "Say yes, and offer a follow-up PR.",
        "draftPointer": "Artifact giveback/33420-reply.md"
      }
    },
    { "op": "close", "key": "t3code-31330:open-on-nod", "resolution": "Approved, PR opened", "closedAt": "2026-11-05T07:00:00Z" }
  ]
}
```

| `op` | Fields | Behaviour |
|---|---|---|
| `open` | `key`, `item` (slug), `kind` ([ask kind](#ask-kind)), `publicLabel` (up to 140) are required. `openedAt` and `private` are optional. | Creates the ask. If the key exists, it updates the label, kind and private fields. It never reopens a closed ask. |
| `close` | `key` is required. `resolution` (up to 200, public) and `closedAt` are optional. | Closes the ask. Closing a closed ask changes nothing. A key that does not exist is an error. |

`private.recommendation` is up to 2,000 characters. `private.draftPointer` is up to 300.

A key may appear once in a request. To open an ask and close it, send two requests.

The server records an `ask_opened` and an `ask_closed` event in the item's history.

#### Text approved in advance for a conditional post

Sometimes Jackson approves the exact text of a post before the post can be made, for example a PR that opens only when a maintainer agrees to the issue. Nothing waits on Jackson then, so do not leave an ask open. Record it as a closed `text_approval` ask whose `resolution` says what was approved and on what condition, and set the item's `waitingOn` to what the condition waits on:

```json
{ "asks": [{ "op": "open", "key": "t3code-34401:pr-text", "item": "my-item", "kind": "text_approval",
             "publicLabel": "Approve the PR description, to be used if the issue is accepted", "openedAt": "2026-10-23T16:00:00Z" }] }
```

```json
{ "asks": [{ "op": "close", "key": "t3code-34401:pr-text",
             "resolution": "Approved 2026-10-24; opens when a maintainer agrees", "closedAt": "2026-10-24T09:00:00Z" }] }
```

```json
{ "items": [{ "slug": "my-item", "waitingOn": "maintainer" }] }
```

The open and the close are two requests, because a key may appear once in a request. When the condition is met, post the approved text; no new ask is needed. The resolution is public for a public item, so keep it to what was approved and the condition.

Response: `{ "ok": true, "results": [{ "key": "...", "id": "...", "status": "created", "open": true }] }`.

### `POST /api/agent/events`

Appends up to 40 events. `key` works as for asks: a retry with the same key adds nothing, and its result says `"status": "exists"`. Keys that start with `auto:` are reserved for the server.

```json
{
  "events": [
    {
      "key": "t3code-33420:review-1",
      "item": "agent-stop-attribution",
      "at": "2026-11-10T12:41:00Z",
      "actor": "maintainer",
      "type": "review",
      "note": "A maintainer verified the change in a real dev environment.",
      "url": "https://github.com/pingdotgg/t3code/pull/33420",
      "isPublic": true
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `key` | string | Required |
| `item` | string | Required. Item slug. |
| `at` | time | Defaults to now |
| `actor` | [event actor](#event-actor) | Required |
| `type` | [event type](#event-type) | Required |
| `note` | string | Required. Up to 280. |
| `url` | string or null | An `https://github.com/` URL, up to 300. The site shows it as "View on GitHub". |
| `isPublic` | boolean | Required. `false` shows the event to the owner only. |

An event cannot be edited. To correct one, delete it and send it again.

### `POST /api/agent/events/delete`

Removes up to 40 events by key. It removes the server's own events too (keys that start with `auto:`), which `POST /api/agent/events` will not let you write. Use it to undo a mistake, such as creation events stamped with the day of a migration. `GET /api/agent/export` returns the key of every event.

```json
{ "keys": ["t3code-33420:review-1", "auto:stage:44db62bf-98be-40ea-9a83-2019e8d39331:1794414478790"] }
```

Response:

```json
{
  "ok": true,
  "deleted": 1,
  "results": [
    { "key": "t3code-33420:review-1", "status": "deleted" },
    { "key": "auto:stage:44db62bf-98be-40ea-9a83-2019e8d39331:1794414478790", "status": "not_found" }
  ]
}
```

A key that names no event is reported as `not_found` in its result. It is not an error, so a retry of a request that already ran returns 200 with every key `not_found`. A key may appear once in a request, and is at most 200 characters.

Deleting an event changes nothing else: an item keeps its stage and an ask stays as it is. To replace a wrongly dated automatic `stage_changed` event, delete it and add an event of type `stage_changed` with the right `at` through `POST /api/agent/events`, under a key of your own.

With the script: `scripts/giveback event delete --key K [--key K ...]`, or `scripts/giveback event delete keys.json` with `{"keys": [...]}` or a plain array.

### `POST /api/agent/links`

Sets the triage fields of up to 40 links without restating any item's link set. Each entry names a link by its `url` and gives `triageBucket`, `triageRank` or both. Only the fields you send are set. `null` clears a field.

```json
{
  "links": [
    { "url": "https://github.com/pingdotgg/t3code/pull/33420", "triageBucket": "needs approval", "triageRank": 12 },
    { "url": "https://github.com/pingdotgg/t3code/pull/32245", "triageRank": null }
  ]
}
```

Response:

```json
{
  "ok": true,
  "results": [
    { "url": "https://github.com/pingdotgg/t3code/pull/33420", "status": "updated", "matched": 2 },
    { "url": "https://github.com/pingdotgg/t3code/pull/32245", "status": "not_found", "matched": 0 }
  ]
}
```

- A URL can sit on more than one item. Every link with that URL is patched, and `matched` says how many there were.
- `status` is `updated` when at least one link changed, `unchanged` when every match already had those values, and `not_found` when no link has the URL. `not_found` is not an error. A retry returns `unchanged`.
- The URL must match the stored one exactly, `#issuecomment-…` included.
- Only `triageBucket` and `triageRank` can be set here. Any other field is refused with a 400; change a link's kind, ownership or role through `links` on `POST /api/agent/items`.
- An entry with neither field is refused, and a URL may appear once in a request.
- An item whose link changed gets a new "last updated" time, as it does when the same change arrives through an upsert.
- A URL carried by more than 10 items is refused. Set it through each item instead.

With the script: `scripts/giveback link triage --url URL [--bucket TEXT | --no-bucket] [--rank N | --no-rank]`, or `scripts/giveback link apply links.json`.

### `GET /api/agent/export`

Returns everything, public and private, as raw table rows. This is how an agent reads the source of truth, and how backups are taken.

A response holds at most 500 rows. Follow `nextCursor` until it is `null`:

```
GET /api/agent/export
GET /api/agent/export?cursor=<nextCursor from the previous response>
```

```json
{
  "ok": true,
  "exportedAt": 1794414478790,
  "revision": 42,
  "itemIdPrefix": "GB",
  "tables": { "items": [], "links": [], "asks": [], "events": [] },
  "nextCursor": "3:v1.hUIlEltc..."
}
```

The tables are `items`, `links`, `asks`, `events`, `itemPrivate`, `askPrivate`, `syncState` and `githubPosts`. A table can be split across two responses; concatenate its rows. `githubPosts` holds one row per repository with rules: our account's posts there as [`POST /api/refresh/posts`](#post-apirefreshposts) last read them, one per line in `posts`. It is private, and the nested export carries it as `githubPosts`. Rows join on `links.itemId`, `asks.itemId`, `events.itemId`, `itemPrivate.itemId` and `askPrivate.askId`.

Each response is a separate read. `revision` goes up on every agent write and every refresh, so if two pages of one export carry different values, a write landed between them and the copy is not consistent: start again. `scripts/giveback export` does this for you.

An item row carries its `number`. Its [ID](#item-ids) is `itemIdPrefix`, a hyphen, and that number: `GB-12`. A row with no `number` is an item the [backfill](#post-apiagentitemsassign-numbers) has not reached.

`scripts/giveback export` follows the cursors and nests the result: each item carries its `shortId` (`"GB-12"`), `links`, `private`, `asks` (each with its `private`) and `events`. `--raw` gives the tables instead. For one item, use `scripts/giveback show GB-12`.

In a row, a field with no value is absent. `items.originRefs` and `links.ghLabels` are one entry per line. The `gh*` fields, `macroscopeVerdict`, `syncedAt` and `syncError` on a link are the GitHub snapshot. `links.ghLastActivityAt` is the thread's "updated" time on GitHub. `links.ghClosingNoticeAt` is when `triage:closing` was last applied to a PR; it is present only while the PR carries that label. `links.ghMergeable` is GitHub's `MERGEABLE`, `CONFLICTING` or `UNKNOWN` for a PR. `links.ghPipelineMarker` and `links.ghPipelineMarkerAt` are the last marker of upstream's [takeover pipeline](#takeover-pipeline) on a PR, such as `stopped-moved`, and the time of the comment that carried it; they are present once a marker has been read. `items.queueRank` and `items.changeKind` are present only when set.

### `GET /api/agent/item-agents`

Bearer `AGENT_SECRET`. Every item that is not closed, with the agent that owns its work.

Each open item has one owning agent. Record it on the item, in two private fields:

- `private.agentName`: what the agent is called, so a person can find it. Use the item's ID and a short title, such as `GB-30 · Merge back tooltip`.
- `private.agentAddress`: where other agents message it, such as its J5 participant id. No spaces.

These two are the one exception to the rule against writing internal identifiers: they are private, they are needed to route a message to the right agent, and they mean nothing outside the owner's own tools. Do not put an address anywhere else.

```json
{
  "ok": true,
  "generatedAt": 1794700000000,
  "unassigned": 1,
  "incomplete": false,
  "items": [
    { "itemSlug": "merge-back-tooltip-unreachable", "itemNumber": 30, "itemShortId": "GB-30", "itemStage": "deciding",
      "agentName": "GB-30 · Merge back tooltip", "agentAddress": "agent:j5:a2a:..." },
    { "itemSlug": "some-new-candidate", "itemNumber": 46, "itemShortId": "GB-46", "itemStage": "found",
      "agentName": null, "agentAddress": null }
  ]
}
```

`unassigned` counts the open items with no `agentAddress`. `incomplete` is `false` in normal operation; if it is ever `true`, the list could not read every private row, an item may show no agent when it has one, and nothing should be dispatched from it. A watcher uses this list to tell an item's agent about activity on its threads; a dispatcher uses it to find items that still need an agent. When an item closes it drops out of the list. Leave the two fields on it: they say who worked the item.

With the script: `scripts/giveback agents`. The script adds one field of its own, `dispatcherAddress`, from the local setting `GIVEBACK_DISPATCHER_ADDRESS` (null when it is not set). The dispatcher is the agent that takes items with no agent.

### `GET /api/agent/capacity`

Bearer `AGENT_SECRET`. Read-only. Whether a [PR slot](#pr-slots) is free, which item is next for one, and how many posts went upstream lately. The dispatcher reads this before it lets an item post.

```json
{
  "ok": true,
  "generatedAt": 1794700000000,
  "repos": [
    {
      "repo": "pingdotgg/t3code",
      "limit": 3,
      "open": 3,
      "free": 0,
      "incomplete": false,
      "slots": [
        {
          "url": "https://github.com/pingdotgg/t3code/pull/33420",
          "repo": "pingdotgg/t3code",
          "number": 33420,
          "title": "fix(server): an agent's Stop no longer reads as the user's",
          "itemSlug": "agent-stop-attribution",
          "itemNumber": 12,
          "itemShortId": "GB-12",
          "itemTitle": "An agent's Stop no longer reads as the user's",
          "itemIsPublic": true,
          "ghState": "open",
          "isDraft": false,
          "createdAt": 1794238603000,
          "ci": "success",
          "labels": ["size:XS", "needs-rebase"],
          "lastActivityAt": 1794634431000,
          "closingClock": { "kind": "rebase", "closesAt": 1795239231000, "due": false },
          "takeover": null,
          "syncedAt": 1794699000000
        }
      ],
      "queue": [
        {
          "position": 1,
          "itemSlug": "composer-draft-lost-on-rename",
          "itemNumber": 27,
          "itemShortId": "GB-27",
          "itemTitle": "Composer draft is lost when its thread is renamed",
          "itemIsPublic": true,
          "itemStage": "held",
          "queueRank": 1,
          "waitingSince": 1794387600000,
          "text": "approved",
          "changeKind": "bug"
        }
      ]
    }
  ],
  "posts": {
    "source": "github",
    "countedAt": 1794699600000,
    "last7Days": 3,
    "weeks": [
      { "start": 1789948800000, "count": 0 },
      { "start": 1794182400000, "count": 3 }
    ],
    "last24Hours": 1,
    "newPrsLast7Days": 0,
    "newIssuesLast7Days": 0,
    "cap": 10,
    "dailyCap": 3,
    "newPrCap": 2,
    "newIssueCap": 2,
    "incomplete": false
  }
}
```

- `repos` has one entry for every repository in the [rules map](#upstreams-pr-rules), whether or not anything of ours is there.
- `slots` are our open PRs, oldest first. `open` is how many there are and `free` is `limit` less `open`, never below 0. When `open` is above `limit`, we are over it: upstream closes a new PR as it opens. **Post only when `free` is above 0.** `incomplete` is `false` in normal operation. It is `true` only when the dashboard holds more of our PR links than one read takes (60, on items that are not closed); `open` is then a floor, `free` is 0, and nothing should be posted on it.
- `ghState` is `open`, or `null` for a link the refresh has not read yet; such a link counts as open. `closingClock` is the [clock](#closing-clocks) running on the PR at `generatedAt`, or `null`. Its `kind` is `notice` or `rebase` (each with `closesAt` and `due`, which is `true` once the deadline has passed), `answered` (with `noticeAt`), or `notice_unknown` (the PR carries the closing label and the time it was applied could not be read).
- `takeover` is what upstream's [takeover pipeline](#takeover-pipeline) is doing with the PR, or `null` when it carries no `takeover:` label: `{ "label": "takeover:in-progress", "state": "in-progress", "known": true, "noPush": true, "stopped": false, "reason": null, "text": "takeover:in-progress" }`. **When `noPush` is `true`, push nothing to the PR's branch.** `known` is `false` for a `takeover:` label the dashboard has not seen before. `text` is what the site shows: the label, with the reason beside it for a stopped pipeline whose marker was read (`reason` is that marker's value without its `stopped-` prefix).
- `queue` is every item that waits on `pr_slot` and is not closed, in order: lowest `queueRank` first, unranked items after, longest-waiting first among equals. `position` is 1 for the item that goes next. `text` is `approved`, `awaiting` or `none`, by the [rule above](#pr-slots), and `null` past the tenth entry, whose asks are not read.
- Non-public items are included, with their slugs and real titles. This endpoint is for agents; do not republish its output.
- `posts` is the count of our own upstream posts: see [the post count](#the-post-count) below.

#### The post count

`posts` counts what our GitHub account posted in the repositories of the [rules map](#upstreams-pr-rules): the last 7 days (`last7Days`), the last 24 hours (`last24Hours`), and each of the last 8 weeks (`weeks`, oldest first). A week starts on Monday 00:00 UTC, and the last entry is the current week, still running.

**It is counted from GitHub, for the whole account.** [`POST /api/refresh/posts`](#post-apirefreshposts) reads the account's posts every 15 minutes, so the count includes a post no agent recorded and every post Jackson writes himself. `source` says where the count comes from, and `countedAt` when GitHub was read for it:

| `source` | Means | `countedAt` | `incomplete` |
|---|---|---|---|
| `github` | Counted from GitHub. Every repository with rules was read successfully in the last 2 hours. | The time of that read: the oldest, when there is more than one repository | `false`, or `true` when GitHub held more than the read took, so the count may be low |
| `events` | The fallback: counted from the events of type `posted`, on every item, public or not. Used when the server secret `GITHUB_LOGIN` is not set, or no read has succeeded for 2 hours. | `null` | Always `true`: this count misses every post nobody recorded |

What counts as one post, from GitHub:

- A PR or an issue the account opened. A PR that upstream's bot closed as it opened counts: it was posted.
- A PR of ours the account reopened. **A reopened PR is a post, and not a new PR**: it counts in `last7Days`, `last24Hours` and `weeks`, never in `newPrsLast7Days`.
- A PR that replaces one the open-PR limit closed. We cannot reopen a PR upstream's bot closed, so its replacement is opened from the same branch. **A replacement counts like a reopen: a post, and not a new PR.** It is recognised from GitHub alone, and every doubt counts as a new PR. A PR is a replacement only when the account's PR just before it, on the same branch of the same head repository, is closed now, and its last close was by `github-actions`, within 10 minutes of its opening, inside the 8 weeks read, and before the replacement was opened. When the search for the account's PRs is cut short, nothing is called a replacement. So a replacement must keep the old PR's branch. On the fallback to `posted` events a replacement cannot be told from a new PR and counts as one.
- A comment on an issue or a PR.
- A submitted review, as one post however many inline comments it carries. A reply in a review thread arrives as a review, so it is one post too.
- A discussion, and a comment or a reply in a discussion.

`newPrsLast7Days` and `newIssuesLast7Days` count a thread once, at its creation. On the fallback they are the `posted` events of the last 7 days whose `url` is a PR's or an issue's own address (`.../pull/123`, `.../issues/123`, with no `#` fragment). The fallback cannot tell a reopened PR from a new one.

The caps are Jackson's own, not upstream's: `cap` is about how many posts may go up in 7 days, `dailyCap` in 24 hours, `newPrCap` and `newIssueCap` how many new PRs and new issues in 7 days. **Before a post, check that it would not take a count past its cap.** The weekly figure is a guide to stay near; the others are firm. When `incomplete` is `true` the real count may be higher than the one shown, so leave room. GitHub is read every 15 minutes, so a post made since `countedAt` is not in the count yet: add it yourself. When a read fails, the last good one keeps being used for up to 2 hours before the count falls back to the events, so always look at how old `countedAt` is.

**Still record every upstream post as a [`posted` event](#event-type)**, with `at` set to when it was posted and `url` set to what was posted. The events are each item's history, which GitHub does not hold, and they are the count whenever GitHub cannot be read.

The post count is private. The site shows it to the owner alone, and no public query returns it.

With the script: `scripts/giveback capacity`.

### `GET /api/agent/watchlist`

Returns every link on an item that is not closed: the upstream threads worth polling. It is read-only, and it is the list to poll from; there is no need to scrape a tracking issue for it.

```json
{
  "ok": true,
  "generatedAt": 1794414478790,
  "revision": 42,
  "links": [
    {
      "url": "https://github.com/pingdotgg/t3code/pull/33420",
      "repo": "pingdotgg/t3code",
      "number": 33420,
      "kind": "pr",
      "ownership": "ours",
      "role": "primary",
      "itemSlug": "agent-stop-attribution",
      "itemNumber": 12,
      "itemShortId": "GB-12",
      "itemStage": "offered",
      "ghState": "open",
      "lastOtherActivityAt": 1794314478000,
      "syncedAt": 1794414000000
    }
  ],
  "nextCursor": null
}
```

- `ghState` (`open`, `closed`, `merged`), `lastOtherActivityAt` and `syncedAt` come from the last [refresh](#post-apirefresh). Each is `null` until the link has been read, and `lastOtherActivityAt` is `null` while nobody but Jackson has commented or reviewed.
- `itemNumber` and `itemShortId` are the item's [ID](#item-ids). Both are `null` for an item not yet numbered.
- Links of non-public items are included, with their slugs. This endpoint is for agents; do not republish its output.
- A link that sits on two open items is listed twice, once per item.
- A response holds at most 500 links. When `nextCursor` is not null, call `GET /api/agent/watchlist?cursor=<nextCursor>` and concatenate. Links come grouped by role: `primary`, then `base`, `covering`, `fixes` and `related`.
- `revision` works as in the export: if two pages carry different values, a write landed between them, so start again. `scripts/giveback watchlist` follows the cursors and does this for you.

### `POST /api/refresh`

Bearer `REFRESH_SECRET`. No body. A scheduler calls this; an agent rarely needs to.

Each call counts against Lakebed's limit of 1,000 writes a day, and one call handles 15 links. With up to 100 links on open items, a full refresh every 15 minutes uses at most 480 calls a day, and [the read of our own posts](#post-apirefreshposts) 96 more. Beyond that, lengthen the interval.

It reads GitHub state for a batch of at most 15 links and stores it on each link: state (`open`, `closed`, `merged`), draft flag, merged and closed times, CI rollup, review decision, labels, head SHA, last activity time (the thread's `updatedAt`), when the `triage:closing` label was last applied (for a PR that carries it), the last marker of the [takeover pipeline](#takeover-pipeline) (for a PR in a repository with rules), the last comment or review by someone other than `Jacksondr5` that is not from a bot, and Macroscope's approvability verdict.

It covers every link on an item that is not closed, `held` items included. A link on a closed item is read once and then left alone.

A link is read through its `repo`, `number` and `kind`, not its URL. A `comment` link therefore gets the state of the thread it is on.

```json
{
  "ok": true,
  "links": 20,
  "refreshed": 19,
  "failed": [{ "url": "https://github.com/expo/expo-device-hub/pull/546", "message": "Not found on GitHub." }],
  "events": 1,
  "nextCursor": "v1.QhLzY8qY...",
  "done": false,
  "rateLimitRemaining": 4667
}
```

When `nextCursor` is not null, call `POST /api/refresh?cursor=<nextCursor>` for the next batch. `scripts/giveback refresh` does this, and then calls [`POST /api/refresh/posts`](#post-apirefreshposts) once.

**The refresh never changes an item's stage.** When a link merges, closes, reopens, or (for our own open PR) begins failing CI, is put on a [closing clock](#closing-clocks) or gets a new [takeover pipeline](#takeover-pipeline) state, it records an event with actor `github` and sets the item's `upstreamChangedAt` and `upstreamChangeNote`. That marker means "something happened upstream that you have not acted on". Read it in the export, decide what the item's stage should be, and send `clearUpstreamChange: true` with your change.

| Event type | When |
|---|---|
| `upstream_merged`, `upstream_closed`, `upstream_reopened` | A link with role `primary`, `fixes` or `related` changed state |
| `dependency_merged`, `dependency_closed` | A link with role `base` or `covering` merged or closed |
| `ci_failing` | CI went from not failing to failing on an open link with ownership `ours` |
| `rebase_requested` | `needs-rebase` is on one of our open PRs and was not in the stored snapshot |
| `closing_notice` | `triage:closing` is on one of our open PRs and was not in the stored snapshot |
| `pipeline_state` | A `takeover:` label is on one of our open PRs, and the stored snapshot had none or a different one |

The two label events are recorded once: later refreshes say nothing while the label stays. If the label is removed and applied again, that is a new event. A PR read for the first time with the label already on it is reported too, because its clock is running. Neither is recorded for a PR that carries `triage:keep-open`, or in a repository with no [rules](#upstreams-pr-rules).

A `pipeline_state` event is recorded the same way: once for each new label, and for a PR read for the first time with a label on it. Its note names the PR and the label as GitHub has it, such as `pingdotgg/t3code#31330 now carries the label takeover:blocked (no-bug-on-base).` A label that is taken off records nothing. When an item gets several notes in one refresh, its marker carries the last: a state that forbids a push, then a closing clock, then any other pipeline state.

When one of our PRs is closed and the same refresh reads a pipeline marker written within an hour of the close, and the marker is not a stop, the close note ends with it: "Upstream's pipeline closed it as: absent." A merge note carries no marker.

If GitHub cannot be reached or answers with an error, the response is `502`, no snapshot is changed, and `nextCursor` repeats the cursor you sent so the batch can be retried. If GitHub answers but has nothing for one link, that link is listed in `failed`, keeps its old snapshot, and gets a `syncError`. The last error is stored in `syncState` and shown on the site.

Limits of the snapshot:

- "Last activity by someone else" looks at the latest 20 comments and the latest 20 reviews. If all of them are from Jackson or bots, the earlier stored value is kept.
- The time of a closing notice is read from the PR's latest 20 label events, as upstream's own bot reads it. If the label is on the PR and its event is not among them, the site says the notice's time is not known.
- The pipeline marker is read from the bodies of a PR's last 8 comments. When none of them carries one, the stored marker is kept only while the PR's `takeover:` label stays the same. A marker older than the present label's own time is set aside as an earlier run's, and so is any marker when that time cannot be read (it comes from the PR's latest 20 label events). The reason can therefore be missing; it is never another run's. The state itself comes from the label, which is read on every refresh.
- The Macroscope verdict is read from the comment the `macroscopeapp` bot posts on a PR (`**Verdict:** ...`), looking at the PR's first four comments. It is null when there is no such comment.
- `triageBucket` and `triageRank` are **not** refreshed. The T3 triage boards publish no readable data: their rankings are compiled into the page's script. An agent that reads a board sets these two fields through [`POST /api/agent/links`](#post-apiagentlinks), or with the rest of the link through `POST /api/agent/items`.

### `POST /api/refresh/posts`

Bearer `REFRESH_SECRET`. No body. Reads our account's own posts from GitHub, for [the post count](#the-post-count). `scripts/giveback refresh` calls it once, after the link batches, so the scheduler that runs the refresh runs this too: one more call per run, 96 a day at 15 minutes.

The account is the server secret `GITHUB_LOGIN`. With it unset, nothing is fetched and nothing is stored, the response is `{ "ok": true, "configured": false, "repos": [] }`, and the count comes from the `posted` events.

One call makes one GitHub request, which covers every repository in the [rules map](#upstreams-pr-rules) and the last 8 weeks, the same weeks the count shows. For each repository it stores one private row: when it was read, whether the read was incomplete, and one line per post holding a time and a kind (`pr`, `issue`, `reopen`, `review`, `comment`, `discussion`, `discussion_comment`). No URL and no title is stored.

```json
{
  "ok": true,
  "configured": true,
  "repos": [{ "repo": "pingdotgg/t3code", "incomplete": false }],
  "rateLimitRemaining": 4650
}
```

The response carries no count. The count is for the owner and for [`GET /api/agent/capacity`](#get-apiagentcapacity).

A read is `incomplete` when GitHub held more than the read took and the rest may fall in the 8 weeks: a search found more threads than it returned (100 PRs or 100 issues the account opened, 50 PRs it reviewed, 50 PRs or 50 issues it commented on), a thread's page came back full with nothing in it older than the 8 weeks (its last 100 comments, 50 reviews or 10 reopenings; the account's newest 20 discussions or 50 discussion comments), or more than 600 posts were found. What was read is kept and counted.

If GitHub cannot be reached, rejects the token, or answers with any error beside its data, the response is `502` with `"ok": false`, an `error` and a `message`. **A failed read changes no count**: each row keeps the posts and the time of its last good read, and the failure is noted beside them (`error` and `errorAt` on the `githubPosts` rows of the [export](#get-apiagentexport)). Once no read has succeeded for 2 hours, the count falls back to the `posted` events. `503` means `GITHUB_TOKEN` is not set, or `GITHUB_LOGIN` is not a GitHub login.

`scripts/giveback refresh` prints this response as `posts` in its output. When it failed, the script also writes a warning to standard error, and still exits 0 if the links were refreshed: its exit status is the links' alone.

A fine-grained `GITHUB_TOKEN` with read-only access to public repositories is enough. GitHub answers such a token with no results, and no error, for a search that does not say `is:pr` or `is:issue`; every search here says one, and the request also counts the repository's PRs as a control. If that control finds none, the read fails with "this token cannot search it" instead of storing a count of nothing.

## Enumerations

Labels are in `shared/enums.ts`.

### Stage

`found`, `validating`, `deciding`, `held`, `preparing`, `approving`, `offered`, `closed`

`held` is a side stop, not a step: see [the model](#the-model).

### Route

| Value | Meaning |
|---|---|
| `direct_pr` | A small, obvious fix goes straight to a PR |
| `issue_first` | Open an issue and wait for a nod |
| `comment` | Comment on an existing thread |
| `discussion` | Open an Ideas discussion |
| `hold` | Keep it, do nothing yet |
| `drop` | Do not give it back |

### Waiting on

`jackson`, `maintainer`, `ci`, `base_pr`, `covering_pr`, `pr_slot`, `giveback_agent`, `upstream_advance`, `nobody`

`pr_slot`: the item's text is ready and our open PRs fill every slot upstream allows. See [PR slots](#pr-slots).

### Change kind

| Value | Meaning |
|---|---|
| `bug` | The product does not do what it already promises: a crash, a regression, a real performance problem |
| `behaviour_change` | It changes how the product behaves. Upstream counts that as a feature, even when the PR calls it a fix. |
| `feature` | It adds something the product does not do yet |

### Outcome

| Value | Meaning |
|---|---|
| `merged` | Our PR was merged |
| `fixed_by_maintainer_pr` | A maintainer fixed it with their own PR |
| `taken_over` | A maintainer took our PR over |
| `covered_by_contributor` | Another contributor's PR covered it |
| `fixed_upstream` | Upstream fixed it independently |
| `not_a_giveback` | It turned out not to be a give-back |
| `parked` | Set aside for now |
| `dropped` | Dropped |
| `closed_by_upstream` | Upstream closed it without merging |

### Link kind

`pr`, `issue`, `comment`, `discussion`

### Link ownership

`ours` (opened from Jackson's account), `theirs`

### Link role

| Value | Meaning |
|---|---|
| `primary` | The item's own upstream post. At most one per item. |
| `base` | A PR ours is stacked on and waits for |
| `covering` | Someone else's PR that may make ours unnecessary |
| `fixes` | The PR that fixed what the item reported |
| `related` | Anything else worth linking |

### Ask kind

`route_decision`, `text_approval`, `bot_ci_findings`, `maintainer_question`, `open_on_nod`, `side_choice`, `triage_move`, `device_needed`

### Event actor

`agent`, `jackson`, `maintainer`, `bot`, `github`

### Event type

`note`, `stage_changed`, `validated`, `route_decided`, `posted`, `ask_opened`, `ask_closed`, `review`, `upstream_merged`, `upstream_closed`, `upstream_reopened`, `ci_failing`, `rebase_requested`, `closing_notice`, `pipeline_state`, `dependency_merged`, `dependency_closed`, `follow_up`

The server records `stage_changed`, `ask_opened`, `ask_closed` and the `upstream_*`, `dependency_*`, `ci_failing`, `rebase_requested`, `closing_notice` and `pipeline_state` types itself. You may also send any of them.

Send a `posted` event for each PR, issue, comment, review or discussion post that goes upstream, and for nothing else. It is the item's own record of the post. [The post count](#the-post-count) is taken from GitHub; when GitHub cannot be read, it is taken from these events instead, one post each.

### Follow-up state

`none`, `owed`, `done`

## Limits

The numbers are in `shared/limits.ts`.

| Limit | Value |
|---|---|
| Items per `POST /api/agent/items` | 25 |
| Links per item | 20 |
| Asks per `POST /api/agent/asks` | 30 |
| Events per `POST /api/agent/events` | 40 |
| Keys per `POST /api/agent/events/delete` | 40 |
| Links per `POST /api/agent/links` | 40 |
| Items one URL may sit on, for `POST /api/agent/links` | 10 |
| Rows per export response | 500 |
| Links per watch list response | 500 |
| Links per refresh call | 15 |
| Posts kept per repository by `POST /api/refresh/posts` | 600 |
| Items in the dashboard | 350 |
| Queue rank | 1 to 999 |
| Queued items whose text approval is read | 10 |
| Items numbered per `POST /api/agent/items/assign-numbers` | 100 by default, 350 at most |
| Summary | 300 characters |
| Event note | 280 characters |
| Private notes | 2,000 characters |

The batch sizes come from Lakebed's per-request limits: 100 index lookups, 1,000 writes, 1,000 rows returned and 5 seconds per transaction. A request over a batch size is refused with a `400` that states the limit.

The whole dashboard may store 1 MiB, and Lakebed allows 1,000 write requests per day. Keep text short, and send changes in batches instead of one request per item.

## Errors

| Status | `error` | Meaning |
|---|---|---|
| 400 | `invalid_json` | The body is not JSON |
| 400 | `validation_failed` | See `errors`. Nothing was applied. |
| 400 | `invalid_cursor` | The cursor is not one the endpoint returned. Start again without it. |
| 401 | `unauthorized` | The bearer secret is missing or wrong |
| 502 | `github_failed` | Refresh only. GitHub could not be read. Nothing was changed. |
| 503 | `not_configured` | A server secret is not set on the deploy |

```json
{
  "ok": false,
  "error": "validation_failed",
  "message": "2 problems found. Nothing was applied.",
  "errors": [
    { "path": "items[0].summary", "message": "Must be at most 300 characters (got 412)." },
    { "path": "items[1].links[0].role", "message": "Must be one of: primary, base, covering, fixes, related." }
  ]
}
```

Each error names the value by its path in the request. Fix every one and send the whole request again.

No endpoint renames a slug or changes an item's ID. To undo a mistaken item, use `POST /api/agent/items/delete`; an item that ran its course is closed with an outcome instead. To undo a mistaken event, use `POST /api/agent/events/delete`.
