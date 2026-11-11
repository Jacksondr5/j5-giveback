# j5-giveback

A public, read-only dashboard of the items J5 Code gives back to upstream repositories. It is a [Lakebed](https://docs.lakebed.dev) capsule. Agents write item state through HTTP endpoints, the server reads PR, issue and discussion state from GitHub, and anyone can read the public data. The owner signs in with Google and also sees private fields.

- `AGENT_API.md`: the HTTP API, for agents. Start there to record or read giveback state.
- `AGENTS.md`: the Lakebed rules for anyone changing the app.

The server is built. `client/index.tsx` is a placeholder that prints the overview as JSON.

## Layout

| Path | Holds |
|---|---|
| `shared/enums.ts` | Stages, routes, outcomes and the other enumerations, with labels |
| `shared/api.ts` | Request and response types for the endpoints and the queries |
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

## Queries

| Query | Who | Returns |
|---|---|---|
| `overview` | Anyone | Stats, pipeline counts, open asks, sync state |
| `items` | Anyone | Every item with its primary link |
| `item(ref)` | Anyone | One item by slug or id, with links, asks and public events |
| `viewer` | Anyone | Whether the caller is signed in, their own user id, and whether they are an owner |
| `ownerOverview`, `ownerItems`, `ownerItem(ref)` | Owner | The same with nothing hidden, plus private fields |

### The privacy boundary

Private data is in two tables, `itemPrivate` and `askPrivate`. The public queries get a database type (`PublicDb`) that does not contain those tables, so a public query that reads them is a TypeScript error. Lakebed's build does not run the type checker, so that guard holds only when the code is checked with `tsc`. The check that runs against real responses is `scripts/privacy-check`.

An item with `isPublic: false` is counted in the totals, the stage counts and the waiting-on counts (never in outcome, follow-up or upstream-change counts, which would reveal its state) and shown as "Undisclosed candidate" with its stage, what it waits on, and its dates. Its only public handle is its row id, a random UUID. `item(ref)` finds it by that id and returns the redacted form; it does not find it by slug, so a guessed slug confirms nothing. Its links and events are not read at all, and its asks show their kind and age but no label.

`scripts/privacy-check` checks all of this against a running dev server: it collects every private value from the full export, runs every public query as an anonymous guest, and fails if any of those values comes back.

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

To find your id: open the site, sign in with Google, and read `userId` in the Viewer block. Add it to `OWNER_IDS` and deploy again. Until `OWNER_IDS` is set, nobody is an owner.

## Run locally

```sh
cp .env.lakebed.server.example .env.lakebed.server   # then fill it in
npx lakebed dev --port 4517

# In another terminal:
export GIVEBACK_URL=http://127.0.0.1:4517 GIVEBACK_ENV_FILE=.env.lakebed.server
scripts/giveback load scripts/seed.json   # every stage and outcome, a non-public item, asks, events
scripts/giveback refresh                  # reads the real upstream PRs in the seed
scripts/privacy-check scripts/seed.json   # exits 0 when nothing private is exposed
```

Local data resets when `lakebed dev` restarts. Load the seed again.

## Things to know

- Lakebed server code has no timers and no `while` loops. The GitHub request uses `AbortSignal.timeout`.
- A handler cannot catch a database error and carry on. Validate before touching the database.
- One request may make 100 index lookups, which is what sets the batch sizes in `shared/limits.ts`.
- Do not deploy with `--public-inspect`. It would make the whole database, private tables included, readable.
