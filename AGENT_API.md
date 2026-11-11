# Giveback dashboard: agent API

This file is for an agent that has to record or read giveback state and has never seen this project.

The giveback dashboard tracks every item that Jackson's fork, J5 Code, gives back to an upstream repository (mainly `pingdotgg/t3code`). It is the source of truth for that state. The site is read-only for people. Agents write to it over HTTP, and read it back over HTTP.

- [Quick start](#quick-start)
- [The model](#the-model)
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

# Read everything back.
scripts/giveback export --out backup.json

# Refresh GitHub state for every link on an open item.
scripts/giveback refresh
```

`upsert`, `ask apply`, `event apply` and `load` split a large file into batches for you.

## The model

An **item** is one thing given back, or considered for it. It has one **stage**, one **waiting on**, and, when closed, one **outcome**.

| Stage | Meaning | Who moves it on |
|---|---|---|
| `found` | A candidate was recorded | Giveback agent |
| `validating` | Being checked against current upstream `main` and searched for duplicates | Giveback agent |
| `deciding` | Validated and real. Needs a route. | Jackson |
| `preparing` | Route chosen. Branch, tests, evidence and post text are being produced. | Giveback agent |
| `approving` | The exact text of the upstream post is ready | Jackson |
| `offered` | Posted upstream and being babysat | Upstream |
| `closed` | Has an outcome | |

An item can move backwards. The agent sets the stage; the server records each change in the item's history.

An item has:

- **Links**: the upstream PRs, issues, comments and discussions it concerns. The server copies GitHub state onto each link (see [refresh](#post-apirefresh)).
- **Asks**: things that need Jackson. An ask is opened and closed by an agent, and has an age.
- **Events**: its history.
- **Private fields**: notes that only the owner sees.

## Privacy rules

The site is public. Read these before writing.

1. **`isPublic` decides whether anyone but the owner sees an item.** When it is `false`, the public sees an "Undisclosed candidate" with only its stage, what it waits on, and its dates. No title, summary, slug, route, links, events or ask labels. Set `isPublic: false` for anything security-sensitive until it is filed upstream. `isPublic` is required when you create an item. There is no default.
2. **Public fields are public.** For a public item, everything outside `private` is shown to everyone: title, summary, route reason, validation verdict, follow-up note, links, ask labels and resolutions, and events with `isPublic: true`.
3. **Private fields are for the owner only.** `private.notes`, `private.impact`, `private.preparedBranch` on an item; `private.recommendation`, `private.draftPointer` on an ask; and events with `isPublic: false`.
4. **Never send these, in any field, public or private**: local paths, host names, ports, thread ids, token locations, or commentary about maintainers. The server rejects any string that contains `/home/`, `/tmp/`, `/mnt/`, `/Users/`, `/root/` or `~/`. It cannot detect the rest. That is your job.
5. **Keys are private.** Ask keys and event keys are never shown publicly, so a key may name its subject.
6. **Write for a stranger.** A summary is one or two plain sentences that someone outside the project can read.

## Endpoints

Every request carries `Authorization: Bearer <secret>`. The agent endpoints take `AGENT_SECRET`. The refresh endpoint takes `REFRESH_SECRET`. Request and response bodies are JSON.

Times in a request are either epoch **milliseconds** or an ISO 8601 string such as `"2026-11-09T15:38:46Z"`. Times in a response are epoch milliseconds.

Each write request is one transaction. If anything in it is invalid, the response is `400` with a list of errors and **nothing is applied**.

### `POST /api/agent/items`

Creates or changes up to 25 items, carrying at most 200 links between them. `slug` identifies an item.

- **To create**: send `slug`, `title`, `summary`, `stage`, `waitingOn`, `targetRepo` and `isPublic`.
- **To change**: send `slug` and the fields that change. An omitted field keeps its value. `null` clears an optional field.
- **`links`**, when present, replaces the item's whole link set. A link is identified by its `url`; a link that stays keeps its GitHub snapshot. Omit `links` to leave them alone.
- **`private`**, when present, is merged field by field into the item's private fields.
- Sending the same request twice changes nothing the second time.

The server does these on its own:

- Records a `stage_changed` event when the stage or the outcome changes, and when an item is created. `stageNote` sets its text.
- Sets `waitingSince` to now when `waitingOn` changes, unless you send `waitingSince`.
- Sets `closedAt` to now when the stage becomes `closed`, unless you send `closedAt`.
- Clears `outcome` and `closedAt` when an item leaves `closed`.

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
| `slug` | string | Required. 3 to 64 characters: lowercase letters, digits, hyphens. It appears in the public URL of a public item. It cannot be changed later. |
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
| `stageNote` | string | Up to 280. Public text for the stage-change event this request causes. Ignored when it causes none. |
| `clearUpstreamChange` | boolean | `true` clears the "state changed upstream" marker (see refresh) |
| `links` | link[] | Up to 20. At most one with role `primary`. |
| `private` | object | `notes` (up to 2,000, may have line breaks), `impact` (up to 2,000), `preparedBranch` (up to 200). Each may be null to clear it. |

Link fields:

| Field | Type | Notes |
|---|---|---|
| `url` | string | Required. Must start with `https://github.com/<repo>/`. |
| `repo` | string | Required. `owner/name`. |
| `number` | number | Required. The PR, issue or discussion number. For a comment, the number of the thread it is on. |
| `kind` | [link kind](#link-kind) | Required |
| `ownership` | [link ownership](#link-ownership) | Required. `ours` if Jackson's account opened it. |
| `role` | [link role](#link-role) | Required |
| `triageBucket` | string or null | Up to 40. The T3 triage board's bucket. Only agents set it; see [refresh](#post-apirefresh). |
| `triageRank` | number or null | Positive whole number |

Unknown fields are rejected, so a misspelled `isPublic` cannot silently publish an item.

Response:

```json
{
  "ok": true,
  "results": [
    { "slug": "agent-stop-attribution", "id": "44db62bf-98be-40ea-9a83-2019e8d39331", "status": "created", "stageEvent": true }
  ]
}
```

`status` is `created`, `updated` or `unchanged`.

### `POST /api/agent/items/delete`

Removes one item together with its links, asks, events and private fields. Use it only to undo a mistake, such as a wrong slug or a duplicate. An item that ran its course is closed with an outcome, never deleted, because its history is the record.

```json
{ "slug": "merge-back-tooltip", "confirm": "merge-back-tooltip" }
```

`confirm` must repeat the slug. The response is `{"ok": true, "deleted": {"slug": "...", "links": 2, "asks": 1, "events": 5}}`. An unknown slug returns 404. An item with more than 45 asks or 800 events returns 409 and is not deleted. To rename a slug, export the item, delete it, and upsert it under the new slug with its asks and events.

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
| `url` | string or null | An `https://` URL, up to 300 |
| `isPublic` | boolean | Required. `false` shows the event to the owner only. |

An event cannot be edited or removed.

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
  "tables": { "items": [], "links": [], "asks": [], "events": [] },
  "nextCursor": "3:v1.hUIlEltc..."
}
```

The tables are `items`, `links`, `asks`, `events`, `itemPrivate`, `askPrivate` and `syncState`. A table can be split across two responses; concatenate its rows. Rows join on `links.itemId`, `asks.itemId`, `events.itemId`, `itemPrivate.itemId` and `askPrivate.askId`.

Each response is a separate read. `revision` goes up on every agent write, so if two pages of one export carry different values, a write landed between them and the copy is not consistent: start again. `scripts/giveback export` does this for you.

`scripts/giveback export` follows the cursors and nests the result: each item carries its `links`, `private`, `asks` (each with its `private`) and `events`. `--raw` gives the tables instead.

In a row, a field with no value is absent. `items.originRefs` and `links.ghLabels` are one entry per line. The `gh*` fields, `macroscopeVerdict`, `syncedAt` and `syncError` on a link are the GitHub snapshot.

### `POST /api/refresh`

Bearer `REFRESH_SECRET`. No body. A scheduler calls this; an agent rarely needs to.

Each call counts against Lakebed's limit of 1,000 writes a day, and one call handles 20 links. With up to 100 links on open items, a full refresh every 15 minutes uses at most 480 calls a day. Beyond that, lengthen the interval.

It reads GitHub state for a batch of at most 20 links and stores it on each link: state (`open`, `closed`, `merged`), draft flag, merged and closed times, CI rollup, review decision, labels, head SHA, last activity time, the last comment or review by someone other than `Jacksondr5` that is not from a bot, and Macroscope's approvability verdict.

It covers every link on an item that is not closed. A link on a closed item is read once and then left alone.

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

When `nextCursor` is not null, call `POST /api/refresh?cursor=<nextCursor>` for the next batch. `scripts/giveback refresh` does this.

**The refresh never changes an item's stage.** When a link merges, closes, reopens, or (for our own open PR) begins failing CI, it records an event with actor `github` and sets the item's `upstreamChangedAt` and `upstreamChangeNote`. That marker means "something happened upstream that you have not acted on". Read it in the export, decide what the item's stage should be, and send `clearUpstreamChange: true` with your change.

| Event type | When |
|---|---|
| `upstream_merged`, `upstream_closed`, `upstream_reopened` | A link with role `primary`, `fixes` or `related` changed state |
| `dependency_merged`, `dependency_closed` | A link with role `base` or `covering` merged or closed |
| `ci_failing` | CI went from not failing to failing on an open link with ownership `ours` |

If GitHub cannot be reached or answers with an error, the response is `502`, no snapshot is changed, and `nextCursor` repeats the cursor you sent so the batch can be retried. If GitHub answers but has nothing for one link, that link is listed in `failed`, keeps its old snapshot, and gets a `syncError`. The last error is stored in `syncState` and shown on the site.

Limits of the snapshot:

- "Last activity by someone else" looks at the latest 20 comments and the latest 20 reviews. If all of them are from Jackson or bots, the earlier stored value is kept.
- The Macroscope verdict is read from the comment the `macroscopeapp` bot posts on a PR (`**Verdict:** ...`), looking at the PR's first four comments. It is null when there is no such comment.
- `triageBucket` and `triageRank` are **not** refreshed. The T3 triage boards publish no readable data: their rankings are compiled into the page's script. An agent that reads a board sets these two fields through `POST /api/agent/items`.

## Enumerations

Labels are in `shared/enums.ts`.

### Stage

`found`, `validating`, `deciding`, `preparing`, `approving`, `offered`, `closed`

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

`jackson`, `maintainer`, `ci`, `base_pr`, `covering_pr`, `giveback_agent`, `upstream_advance`, `nobody`

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

`note`, `stage_changed`, `validated`, `route_decided`, `posted`, `ask_opened`, `ask_closed`, `review`, `upstream_merged`, `upstream_closed`, `upstream_reopened`, `ci_failing`, `dependency_merged`, `dependency_closed`, `follow_up`

The server records `stage_changed`, `ask_opened`, `ask_closed` and the `upstream_*`, `dependency_*` and `ci_failing` types itself. You may also send any of them.

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
| Rows per export response | 500 |
| Links per refresh call | 20 |
| Items in the dashboard | 400 |
| Summary | 300 characters |
| Event note | 280 characters |
| Private notes | 2,000 characters |

The batch sizes come from Lakebed's per-request limits: 100 index lookups, 1,000 writes and 1,000 rows returned. A request over a batch size is refused with a `400` that states the limit.

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

There is no endpoint that deletes an item or renames a slug. Close a mistaken item with the outcome `dropped`.
