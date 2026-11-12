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
| `server/schema.ts` | Tables and indexes |
| `server/read.ts` | Read paths over the public tables |
| `server/owner.ts` | Owner read paths, which add the private tables |
| `server/agent.ts`, `server/validate.ts` | The agent endpoints and their payload validation |
| `server/refresh.ts`, `server/github.ts` | The GitHub refresh |
| `server/auth.ts` | Bearer check and owner check |
| `scripts/giveback` | Command-line client for agents |
| `scripts/seed.json` | Seed data for local development |
| `scripts/privacy-check` | Proves the public queries leak nothing private (local only) |
| `ops/` | The two scheduled jobs (GitHub refresh, daily backup) and their systemd timers |

## Queries

| Query | Who | Returns |
|---|---|---|
| `overview` | Anyone | Stats, pipeline counts (the `held` side stop included), open asks, sync state |
| `items` | Anyone | Every item with its number and its primary link |
| `item(ref)` | Anyone | One item by ID (`GB-12`, either case), slug or row id, with links, asks and public events |
| `viewer` | Anyone | Whether the caller is signed in, their own user id, and whether they are an owner |
| `ownerOverview`, `ownerItems`, `ownerItem(ref)` | Owner | The same with nothing hidden, plus private fields |

### The privacy boundary

Private data is in two tables, `itemPrivate` and `askPrivate`. The public queries get a database type (`PublicDb`) that does not contain those tables, so a public query that reads them is a TypeScript error. Lakebed's build does not run the type checker, so that guard holds only when the code is checked with `tsc`. The check that runs against real responses is `scripts/privacy-check`.

An item with `isPublic: false` is counted in the totals, the stage counts and the waiting-on counts (never in outcome, follow-up or upstream-change counts, which would reveal its state) and shown as "Undisclosed candidate" with its ID, its stage, what it waits on, and its dates. Its public handles are its ID and its row id, a random UUID; the site links to it by ID. A bare number says nothing about the item, and it is how the owner and the agents name it. `item(ref)` finds it by either handle and returns the same redacted form; it does not find it by slug, so a guessed slug confirms nothing. Its links, asks and events are not read at all, and its asks do not appear in the public "Needs Jackson" queue.

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
scripts/giveback load scripts/seed.json   # every stage and outcome, two held items, a non-public item, asks, events
scripts/giveback refresh                  # reads the real upstream PRs in the seed
scripts/privacy-check scripts/seed.json   # exits 0 when nothing private is exposed
```

Local data resets when `lakebed dev` restarts. Load the seed again.

## Scheduled jobs

Lakebed has no scheduler, so two jobs run from a machine that stays on, as systemd user timers. `ops/` holds them.

| Timer | When | What it runs |
|---|---|---|
| `giveback-refresh` | Every 15 minutes | `ops/bin/refresh.sh`: asks the site to re-read the state of every open upstream thread from GitHub |
| `giveback-backup` | Daily at 08:40 | `ops/bin/backup.sh`: saves a full export and deletes copies older than 30 days |

Install or update them, from a checkout on that machine:

```sh
ops/install.sh               # writes the units to ~/.config/systemd/user and starts the timers
ops/install.sh --uninstall   # stops the timers and removes the units
```

The installed units carry this checkout's path and run the scripts straight from it, so pulling the repository updates the jobs. Run `ops/install.sh` again if the checkout moves. For the timers to run while nobody is logged in, turn lingering on once: `loginctl enable-linger "$USER"`.

The jobs find Node on `PATH`, then where fnm, Volta and nvm keep their default version. Set `GIVEBACK_NODE` to choose one.

Two things on that machine are local and must never be committed:

- `~/.config/j5-giveback/env`: the site URL and the two bearer secrets. Three `KEY=value` lines: `GIVEBACK_URL`, `GIVEBACK_AGENT_SECRET`, `GIVEBACK_REFRESH_SECRET`. Keep it readable by its owner only.
- `~/.local/share/j5-giveback/backups/`: the exports. Each holds everything, private fields included. The dashboard is the only other copy of this data, and Lakebed's alpha gives no recovery guarantee.

Check on them:

```sh
systemctl --user list-timers | grep giveback
journalctl --user -u giveback-refresh.service -n 20
```

A failed refresh shows on the site as a stale sync. A failed backup shows nowhere but the journal.

## Things to know

- Lakebed server code has no timers and no `while` loops. The GitHub request uses `AbortSignal.timeout`.
- A handler cannot catch a database error and carry on. Validate before touching the database.
- One request may make 100 index lookups, which is what sets the batch sizes in `shared/limits.ts`.
- One request is one transaction, cancelled after 5 seconds. The number backfill numbers 100 items per call for that reason, and says how many remain.
- Do not deploy with `--public-inspect`. It would make the whole database, private tables included, readable.
