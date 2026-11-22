# Lakebed app instructions

Treat this capsule directory as the whole app. Use Lakebed's built-in APIs and CLI.

## Limits to check first

- The public alpha is not production-ready.
- Lakebed is free-only. Claiming does not raise limits. Read https://docs.lakebed.dev/limits/ before sizing an app.
- For supported platforms, SDK compatibility, persistence, and support routes, read https://docs.lakebed.dev/support/.
- App code cannot use arbitrary npm packages or Node built-ins. Do not install app dependencies.
- Database fields support `string()`, `boolean()`, `number()`, `id(...)`, and `userId()`. Chain `.optional()` or `.default(value)` on any field.
- Local database data and uploaded files reset when the dev server restarts.
- Hosted server secrets and outbound server-side `fetch` require a claimed deploy.
- Unclaimed deploys expire. Use the expiry printed by the CLI. Claimed deploys do not expire.

## App structure and APIs

- `server/index.ts` exports the default `capsule()` definition. Put server code in `server/`. Import from `lakebed/server` or relative server and shared files.
- `client/index.tsx` exports `App`. Put client code in `client/`. Import from `lakebed/client`, `preact`, `preact/hooks`, `preact/jsx-runtime`, `preact/jsx-dev-runtime`, or relative client and shared files.
- Keep `shared/` pure TypeScript. Do not import DOM APIs, Node built-ins, env values, or Lakebed runtimes there.
- In client code, use `import type app from "../server/index"` and `createClient<typeof app>()` for typed queries, mutations, and actions. Query hooks return `undefined` until the first result arrives.
- Database calls are async. Await or return every database operation. Declare indexes with `.index(name, fields)` and query with `withIndex`. Use `by_creation` for unfiltered creation-order queries. Do not use legacy `where`, `orderBy`, `limit`, or `all`.
- Queries and actions cannot write to the database. Use mutations or endpoints for writes. Filter user-owned data by the caller's `userId` and check ownership again before updates or deletes.
- Guests get protected browser sessions without setup. Use `ctx.auth` on the server and `useAuth()` on the client. A user ID is not a credential. Do not invent guest IDs or check their prefixes.
- Use `ctx.auth.requireIdentity()` for data that belongs to a guest or signed-in user. Use `ctx.auth.requireSignedIn()` for account-only operations. `isGuest` and `isSignedIn` are separate checks. Neither is true without a session.
- Set `auth: { requireSignIn: true }` in `capsule()` to block all app data operations until sign-in. Client UI checks alone do not protect data. On the client, gate data components on `canAccessApp()` from `lakebed/client`.
- If `auth.error` blocks access, show `retryAuth()` and Google sign-in. Retry cannot renew an expired or revoked token for a pending guest upgrade. Keep data components unmounted until auth recovers.
- Declare Lakebed user fields with `userId()` from `lakebed/server`, never `string()`. When a guest signs in, declared `userId()` fields follow them to their account. `userId()` does not grant access. Keep owner filters and ownership checks. Make shared data intentional with a shared query, not a fake global user.
- Use `auth.onGuestUpgrade` only for app-specific merge rules. It runs before automatic reference transfer in the same transaction. Plain strings, profile text, and external data do not transfer automatically.
- Add Google sign-in with `SignInWithGoogle` or `signInWithGoogle()` from `lakebed/client`. For custom endpoints, send the identity token from `getIdentity().token` in the `X-Lakebed-Token` header. `Authorization` belongs to the app. Same-origin guest cookies work without that header.
- Read server secrets through `ctx.env`, with values in `.env.lakebed.server`. They are not available at build time. Never put secrets in client or shared code. Deploy sync replaces hosted env with the file contents after the deploy is claimed.
- Use complete Tailwind class names in JSX. Lakebed compiles CSS automatically from client files and their imports. Use inline styles for values loaded at runtime. Do not add CSS files, CSS modules, PostCSS, or a separate Tailwind build step.
- Use the router from `lakebed/client` for pages. There is no file-based routing. Use `endpoint({ method, path }, handler)` from `lakebed/server` for webhooks and external HTTP clients. Request helpers include `headers.get(name)`, `query`, `json()`, `text()`, and `bytes()`.
- To let browser agents use the app, pass `{ tool: { description, args } }` as the second argument to `query`, `mutation`, or `action`. Build `args` from `string()`, `number()`, `boolean()`, and `id(...)`. The handler then takes one object, and client code calls it with that object. Write descriptions for an agent. See https://docs.lakebed.dev/agent-tools/.
- Static capsule assets are limited to the favicon. Use `favicon.svg`, `favicon.ico`, or the `favicon` option in `capsule()`. Use `client.storage` for user uploads.

## External data and dashboards

Use global `fetch(url, options)` inside a handler, not `ctx.fetch`. Queries, mutations, actions, and endpoints can fetch locally and on claimed deploys. A mutation or writable endpoint can fetch external data and write rows in the same call. Data does not need to pass through the browser. Fetch shares the handler time budget and can hold up other writes, so ingest one small batch per call.

Lakebed has no built-in scheduler or durable continuation queue yet. For periodic ingest, use an external scheduler to call a protected `POST` endpoint. Return a cursor for the caller to advance across separate requests. Keep `auth.requireSignIn` off for public reads and check an app secret in the ingest endpoint. CLI deploy tokens do not authenticate app endpoint callers.

Database read budgets apply to the whole handler. A loop over `paginate()` does not bypass them. For totals larger than one handler can read, maintain summary rows during ingest. Store timestamps with `number()` as epoch milliseconds. See the [handler capability table](https://docs.lakebed.dev/capsule-api/index.md#handler-capabilities), [dashboard ingest example](https://docs.lakebed.dev/database/index.md#dashboard-counts), and [resource limits](https://docs.lakebed.dev/limits/index.md) before planning a backfill.

## Run and verify

Run commands from this capsule directory with `npx lakebed`.

Start dev in a terminal session that can stay open:

```sh
npx lakebed dev
```

Keep that process running. Edit the starter to build the requested app, then test its behavior at the URL printed by dev. Use another terminal to inspect logs and data:

```sh
npx lakebed logs --port 3000
npx lakebed db dump --port 3000
```

Use the dev server's port if it differs from 3000. Fix compile errors and runtime errors before deploying. Check user-owned data with separate browser profiles or the `?lakebed_guest=<name>` local test override when the app stores private data. Named overrides are local test identities and cannot upgrade to an account.

### Local development notes

Checked on Lakebed 0.0.41. Re-check them after a Lakebed upgrade.

- **Work in a worktree, not in the checkout that deploys.** That checkout's `.env.lakebed.server` holds the live values, and `npx lakebed deploy` replaces the hosted env with that file. The scheduled jobs also run `ops/bin/*.sh` straight from it, so leaving it on a feature branch puts unreviewed code on the timers. A worktree has no `.env.lakebed.server` (it is git-ignored): write one with secrets you make up.
- **Point the scripts at the local server, every time.** `scripts/giveback` and `scripts/privacy-check` talk to the live site unless both `GIVEBACK_URL=http://127.0.0.1:<port>` and `GIVEBACK_ENV_FILE=.env.lakebed.server` are set on the command.
- **Hot reload keeps data.** `npx lakebed dev` picks up edits to `server/`, `client/`, `.env.lakebed.server` and schema changes (a new index included) without a restart, and the local database survives. Only a restart resets data. To test a branch against old data, check out `main`'s `server client shared scripts`, start dev and seed, then check out `HEAD`'s on the same running server.
- **Stop the dev server by its port,** not by a name pattern: `ss -ltnp 'sport = :<port>'` gives the PID. A pattern such as `lakebed dev` also matches the shell that runs the kill.
- **A hot reload reloads the tab at its current URL.** A tab opened with `?lakebed_guest=<name>` keeps that identity through in-app navigation, and loses it at the next hot reload unless the URL still carries the parameter. Load the URL with the parameter again. To move between pages without a reload: `history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'))`.
- **Owner view locally:** a named guest's id is `guest:<name>`. Google sign-in isn't reachable locally, so in a worktree make a temporary, uncommitted edit to `server/auth.ts` (`isOwner` without the signed-in test, `requireOwner` with `requireIdentity()`), and set `OWNER_IDS=guest:<name>` in the worktree's env file. Before committing, `git checkout server/auth.ts` and confirm `git diff main -- server/auth.ts` is empty.
- **`scripts/privacy-check` runs against a local server only.** It reads the public queries over the WebSocket, and the hosted one needs a browser session. Check the hosted site's leaks in a browser.
- **Type-check without `node_modules`:** use a scratch `tsconfig.json` with `baseUrl` at the npx cache that holds `lakebed` and `preact` (`~/.npm/_npx/*/node_modules`), `paths` `lakebed/*` → `lakebed/dist/*`, `jsx: react-jsx`, `jsxImportSource: preact`, and run the cached `typescript` binary, which may sit in another directory of that cache. Pure helpers: `npx esbuild client/lib/lib.check.ts --bundle --format=esm | node --input-type=module`.
- **Query errors throw during render.** `client.useQuery` throws the server's error, so each page needs an error boundary. Lakebed's `ErrorBoundary` wraps children in a `div`, so it can't sit inside a `ul`.
- **The 1 MiB limit is on the `artifact` object in the build output,** not on the file (`lakebed/dist/anonymous/validate.js`). The file `npx lakebed build --out <path>` writes also holds the client bundle and is about 300 KB larger; measure `d.artifact` with `node -e`. Server source is expensive: unminified, base64-encoded and with an inline source map, a kilobyte of `server/` or `shared/` TypeScript costs 3 to 4 KB of artifact.
- **Transactions are cancelled after 5,000 ms,** which is tighter than the 1,000-write limit for a loop of single-row updates. A handler that fetches shares that time: the GitHub reads use a 3.5-second timeout for that reason.
- **Tailwind 4 breakpoint order:** an arbitrary pixel variant such as `min-[1800px]:` sorts before `xl:` and loses to it. Write it in rem (`min-[112.5rem]:`). Container queries work.

## Deploy and verify

After local checks pass, deploy from another terminal:

```sh
npx lakebed deploy
```

If the CLI requires a claim for server secrets or outbound fetch, follow its claim instructions and deploy again. A claim-required preview is not a working app.

Open the returned URL and test the requested behavior. Inspect the deployed app from this capsule directory, using its returned ID or URL:

```sh
npx lakebed inspect <deploy-id-or-url>
npx lakebed logs <deploy-id-or-url>
```

Hosted inspection is private by default. The CLI uses saved credentials. Report the working URL, the checks you ran, and the expiry if the deploy is unclaimed. Default app URLs use `lakebed.app` subdomains.

## Read when needed

- For server and client API details, read the [capsule API](https://docs.lakebed.dev/capsule-api/index.md).
- For indexes and queries, read the [database guide](https://docs.lakebed.dev/database/index.md).
- For Google sign-in and identity, read the [auth guide](https://docs.lakebed.dev/auth/index.md).
- For user uploads, read the [storage guide](https://docs.lakebed.dev/storage/index.md).
- For claiming, domains, and other CLI commands, read the [reference](https://docs.lakebed.dev/reference/index.md).
- For an older capsule using synchronous database calls, read the [migration guide](https://docs.lakebed.dev/database-migration/index.md).
- For anything else, read the [docs index](https://docs.lakebed.dev/llms.txt). It lists every page and section so you can fetch only the one you need.
