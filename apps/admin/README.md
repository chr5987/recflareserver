# admin

A standalone Cloudflare Worker for player management: search accounts, grant
or revoke the `developer`/`moderator` roles, and ban or unban a player. It is
deployed separately from every other worker and gates access to the
dashboard on the `developer` role specifically — a `moderator`-only account
can sign in (its credentials are valid) but is refused the dashboard.

## Architecture

Like `www`, this is a React SPA (`src/client/`, built by Vite, served via the
`ASSETS` binding) plus a thin Hono worker (`src/admin.app.ts`). Unlike `www`,
it is **not** a backend-for-frontend: the SPA calls `auth` and `api`
*directly* over CORS, the same way the game client and `www`'s existing admin
tab already do. The worker itself serves exactly one route of its own:

| Method | Path          | Purpose                                          |
| ------ | ------------- | ------------------------------------------------- |
| GET    | `/api/config` | Tells the SPA where `auth`/`api` live             |

Everything else falls through to the built SPA (`not_found_handling:
single-page-application`).

### Access control

Sign-in posts straight to `auth`'s `POST /connect/token` (the same grant the
game and `www` use) and stores the returned JWT in `localStorage`. The
token's `role` claim is decoded client-side; without `developer` in it, the
SPA shows "Developer access required" instead of the dashboard.

**This client-side check is UX only.** The real enforcement is server-side:
every admin route this SPA calls —

- `auth`: `GET /admin/accounts/search`, `GET /admin/accounts/:id`,
  `POST /admin/accounts/:id/roles`
- `api`: `GET /admin/bans/:playerId`, `POST /admin/bans/:playerId`,
  `POST /admin/bans/:playerId/lift`

— independently validates the bearer token and requires `developer`
specifically (401 for no/invalid token, 403 for a valid token missing the
role). A forged or stale client can't get further than a real developer
token would.

Upstream hosts are derived from the shared base domain (`auth.<DOMAIN>`,
`api.<DOMAIN>`), where `DOMAIN` is injected at deploy time (see
`run-wrangler-deploy`). For local dev/preview, point the `DOMAIN` var in
`wrangler.jsonc` at a deployed domain so the dashboard can reach real data.

## Development

### Run in dev mode

```sh
pnpm turbo dev
```

### Run tests

```sh
pnpm test
```

### Deploy

```sh
pnpm turbo deploy
```
