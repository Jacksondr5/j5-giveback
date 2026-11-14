# j5-giveback

A public, read-only dashboard of the items J5 Code gives back to upstream repositories. It is a [Lakebed](https://docs.lakebed.dev) capsule. Agents write item state through HTTP endpoints, the server reads PR, issue and discussion state from GitHub, and anyone can read the public data. The owner signs in with Google and also sees private fields.

- `AGENT_API.md`: the HTTP API, for agents. Start there to record or read giveback state.
- `AGENTS.md`: the Lakebed rules for anyone changing the app.

Every item has a short ID, `GB-<n>` (GB for give-back), that a person can say or type: "what's the status of GB-12?". The server numbers items in order from 1. A number never changes and is never reused, and it is public for every item, undisclosed ones included. `/items/GB-12` is the item's page. The prefix is one constant in `shared/itemId.ts`.

`server/` holds the schema, the public and owner queries, the agent endpoints and the GitHub refresh. `client/` holds the four pages: overview, item list, item and how it works. `shared/` holds the types, labels and limits both sides use.

## Layout

| Path | Holds |
|---|---|
| `shared/enums.ts` | Stages, routes, outcomes and the other enumerations, with labels |
| `shared/api.ts` | Request and response types for the endpoints and the queries |
| `shared/itemId.ts` | The item ID: its prefix, and how it is formatted and parsed |
| `shared/limits.ts` | Length and batch limits |
| `shared/upstreamRules.ts` | The rules an upstream repository enforces by bot: the open PR limit, the closing clocks, and the count of posts per week |
| `server/schema.ts` | Tables and indexes |
| `server/read.ts` | Read paths over the public tables |
| `server/owner.ts` | Owner read paths, which add the private tables |
| `server/agent.ts`, `server/validate.ts` | The agent endpoints and their payload validation |
| `server/capacity.ts` | The capacity endpoint and the count of upstream posts, for the owner and the agents only |
| `server/refresh.ts`, `server/github.ts` | The GitHub refresh |
| `server/auth.ts` | Bearer check and owner check |
| `scripts/giveback` | Command-line client for agents |
| `scripts/seed.json` | Seed data for local development |
| `scripts/privacy-check` | Proves the public queries leak nothing private (local only) |
| `ops/` | The two scheduled jobs (GitHub refresh, daily backup) and their systemd timers |

## Queries

| Query | Who | Returns |
|---|---|---|
| `overview` | Anyone | Stats, pipeline counts (the `held` side stop included), open asks, PR slots and the queue for them, sync state |
| `items` | Anyone | Every item with its number and its primary link |
| `item(ref)` | Anyone | One item by ID (`GB-12`, either case), slug or row id, with links, asks and public events |
| `viewer` | Anyone | Whether the caller is signed in, their own user id, and whether they are an owner |
| `ownerOverview`, `ownerItems`, `ownerItem(ref)` | Owner | The same with nothing hidden, plus private fields |
| `ownerPosts` | Owner | Upstream posts in the last 7 days and each of the last 8 weeks, on every item, public or not |

### The privacy boundary

Private data is in two tables, `itemPrivate` and `askPrivate`. The public queries get a database type (`PublicDb`) that does not contain those tables, so a public query that reads them is a TypeScript error. Lakebed's build does not run the type checker, so that guard holds only when the code is checked with `tsc`. The check that runs against real responses is `scripts/privacy-check`.

An item with `isPublic: false` is counted in the totals, the stage counts and the waiting-on counts (never in outcome, follow-up or upstream-change counts, which would reveal its state) and shown as "Undisclosed candidate" with its ID, its stage, what it waits on, and its dates. Its public handles are its ID and its row id, a random UUID; the site links to it by ID. A bare number says nothing about the item, and it is how the owner and the agents name it. `item(ref)` finds it by either handle and returns the same redacted form; it does not find it by slug, so a guessed slug confirms nothing. Its links, asks and events are not read at all, and its asks do not appear in the public "Needs Jackson" queue.

Two public facts follow from what a non-public item waits on. One that waits for a PR slot is listed in the overview's queue by its ID and its position, with nothing about its text. One whose open PR is ours shows as a filled slot, by its ID, with nothing about the PR. Both place it in a repository, which its redacted form otherwise withholds; that was accepted so that the count of free slots is true for everyone. The count of upstream posts includes non-public items, so it is private: only `ownerPosts` and the agent's capacity endpoint return it.

`scripts/privacy-check` checks all of this against a running dev server: it collects every private value from the full export, runs every public query as an anonymous guest, and fails if any of those values comes back.

### Item numbers on a database that predates them

The schema change is additive: `items.number` and `syncState.nextItemNumber` are optional fields, and `items.by_number` is a new index. Lakebed fails a deploy that adds a required field to a table with rows; an optional field, indexed or not, needs no rewrite of stored rows. Until the backfill runs, the stored items have no number: every page and endpoint works, and the site shows them without an ID.

After the deploy that adds IDs, run the backfill once:

```sh
scripts/giveback assign-numbers
```

It numbers the items that have none, oldest find first, and prints each slug with its new ID. It is safe to run again: an item that has a number keeps it. The counter that hands out the next number is stored on the `syncState` row the first time a number is assigned; while it is absent, the next number is one more than the highest in use.

## Server secrets

Put these in `.env.lakebed.server`, which Git ignores. `.env.lakebed.server.example` lists them.

| Name | Used for |
|---|---|
| `AGENT_SECRET` | Bearer secret for `/api/agent/*` |
| `REFRESH_SECRET` | Bearer secret for `/api/refresh` |
| `GITHUB_TOKEN` | Reading GitHub. Read-only access to public repositories is enough. |
| `OWNER_IDS` | Lakebed user ids that may read private data, separated by commas or spaces |
| `GITHUB_SELF_LOGIN` | Optional. The fork owner's GitHub login. Default `Jacksondr5`. |
| `GITHUB_GRAPHQL_URL` | Optional, for tests against a stand-in server. Leave it unset in a deploy. |

### Becoming an owner

The owner check uses the account's Lakebed `userId`. Lakebed documents it as the one stable authorization key of a signed-in account, and documents email as profile data that is "not an authorization key". So the allow-list holds ids, not email addresses.

To find your id: open the site, sign in with Google, and copy the account id from the note under the navigation, which appears for a signed-in account that is not an owner. Add it to `OWNER_IDS` and deploy again. Until `OWNER_IDS` is set, nobody is an owner.

## Run locally

```sh
cp .env.lakebed.server.example .env.lakebed.server   # then fill it in
npx lakebed dev --port 4517

# In another terminal:
export GIVEBACK_URL=http://127.0.0.1:4517 GIVEBACK_ENV_FILE=.env.lakebed.server
scripts/giveback load scripts/seed.json   # every stage and outcome, held and queued items, non-public items, asks, events
scripts/giveback refresh                  # reads the real upstream PRs in the seed, and starts their closing clocks
scripts/privacy-check scripts/seed.json   # exits 0 when nothing private is exposed
```

Local data resets when `lakebed dev` restarts. Load the seed again.

## Scheduled jobs

Lakebed has no scheduler, so three jobs run from a machine that stays on, as systemd user timers. `ops/` holds them.

| Timer | When | What it runs |
|---|---|---|
| `giveback-refresh` | Every 15 minutes | `ops/bin/refresh.sh`: asks the site to re-read the state of every open upstream thread from GitHub |
| `giveback-backup` | Daily at 08:40 | `ops/bin/backup.sh`: saves a full export and deletes copies older than 30 days |
| `giveback-watch` | Every 15 minutes, 3 minutes after the refresh | `ops/bin/watch.sh`: checks the upstream threads of every item that is not closed, and messages the agent that owns the item when one has new activity |

Install or update them, from a checkout on that machine:

```sh
ops/install.sh               # writes the units to ~/.config/systemd/user and starts the timers
ops/install.sh --uninstall   # stops the timers and removes the units
```

The installed units carry this checkout's path and run the scripts straight from it, so pulling the repository updates the jobs. Run `ops/install.sh` again if the checkout moves. For the timers to run while nobody is logged in, turn lingering on once: `loginctl enable-linger "$USER"`.

The jobs find Node on `PATH`, then where fnm, Volta and nvm keep their default version. Set `GIVEBACK_NODE` to choose one.

Three things on that machine are local and must never be committed:

- `~/.config/j5-giveback/env`: the site URL and the two bearer secrets, as `KEY=value` lines: `GIVEBACK_URL`, `GIVEBACK_AGENT_SECRET`, `GIVEBACK_REFRESH_SECRET`. The watcher's settings go here too (below). Keep it readable by its owner only.
- `~/.local/share/j5-giveback/backups/`: the exports. Each holds everything, private fields included. The dashboard is the only other copy of this data, and Lakebed's alpha gives no recovery guarantee.
- `~/.local/share/j5-giveback/watch/state.json`: what the watcher has read, and the messages it has yet to deliver. It names agents' addresses and non-public items' threads.

Check on them:

```sh
systemctl --user list-timers | grep giveback
journalctl --user -u giveback-refresh.service -n 20
```

A failed refresh shows on the site as a stale sync. A failed backup or a failed watch shows nowhere but the journal.

### The watcher

`ops/bin/watch.sh` reads `giveback watchlist` for the threads and `giveback agents` for who owns each item, asks GitHub what happened on each thread since its last run, and sends one message per item with `j5 a2a send`. An item with no recorded agent goes to the dispatcher. It needs `gh` (signed in), `jq` and the `j5` binary.

How closely a thread is watched depends on its links:

| Link | What is reported |
|---|---|
| `ours` (a thread we posted in) | Comments, reviews, labels, PRs that reference it, review-bot verdicts, failing checks |
| `theirs`, role `base` or `covering` | Comments and reviews by people, and the thread closing, merging or reopening |
| `theirs`, role `related` | A change of state alone, taken from the dashboard's own snapshot |

When one of our own PRs closes or merges, the dispatcher gets a note of its own as well: upstream limits how many PRs we may have open, so a close frees a slot for the next item in the queue.

A thread of ours stays watched for 14 days after its item closes, because a reply or a reopening often follows a close. The watcher remembers those threads itself, since the watch list no longer names them.

Settings, in `~/.config/j5-giveback/env`:

| Name | Purpose |
|---|---|
| `GIVEBACK_DISPATCHER_ADDRESS` | Required. The dispatcher agent's address. `giveback agents` prints it too. |
| `J5_TOKEN_FILE` | Required. A file holding the token from `j5 a2a token issue`. |
| `GIVEBACK_J5_BIN` | The `j5` binary, when it is not on the timer's `PATH` |
| `J5CODE_HOME`, `J5_ORIGIN` | Passed to `j5` when set |
| `GIVEBACK_GITHUB_LOGIN` | Our own login, whose activity is not news. Default: the login `gh` is signed in with. |
| `GIVEBACK_MAINTAINERS` | Free text naming the upstream maintainers. It is added to each message. |
| `GIVEBACK_OWNER_NAME` | Who approves what is posted upstream, as the messages name them. Default: "the owner". |
| `GIVEBACK_WATCH_LINGER_DAYS` | Days a thread of ours stays watched after its item closes. Default 14. |

`ops/bin/watch.sh --dry-run` prints what it would send, and sends and remembers nothing.

News goes into a queue in `state.json` before anything is sent, and leaves it only when its message is accepted. A message that fails is sent again on the next run, with the same news under the same id, so it does not arrive twice. (The lines around the news can differ on a retry, for example when the item has changed hands.) One that cannot be delivered for 14 days is dropped, with a line in the journal. If the list of item agents says it is incomplete, the run stops before it checks or sends anything.

## Things to know

- Lakebed server code has no timers and no `while` loops. The GitHub request uses `AbortSignal.timeout`.
- A handler cannot catch a database error and carry on. Validate before touching the database.
- One request may make 100 index lookups, which is what sets the batch sizes in `shared/limits.ts`. The overview makes at most 14, and the owner's overview one more per open ask, up to 75: see `readOverview` before adding a read to either.
- One request is one transaction, cancelled after 5 seconds. The number backfill numbers 100 items per call for that reason, and says how many remain.
- Do not deploy with `--public-inspect`. It would make the whole database, private tables included, readable.
