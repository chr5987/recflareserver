import { Hono } from 'hono'
import { useWorkersLogger } from 'workers-tagged-logger'

import { withOnError } from '@repo/hono-helpers'

import type { App } from './context'

/**
 * admin — the standalone admin worker. It serves the React SPA (player search, role
 * grants, bans) and exactly one route of its own: `/api/config`, which tells the SPA
 * where `auth` and `api` live so it can call them DIRECTLY, the same pattern `www` uses
 * for the rest of the game's endpoints.
 *
 * There is no server-side auth gate here on purpose: this worker holds no data of its
 * own and proxies nothing. The real authorization lives on the `auth`/`api` routes the
 * SPA calls (`/admin/*` on each, gated on the `developer` role) — this worker only
 * decides, client-side, whether to SHOW the dashboard instead of a "developer access
 * required" screen. A visitor who reaches this worker without a developer token gets a
 * built React page that goes nowhere, not access to anything.
 */

const authBase = (env: App['Bindings']): string => `https://auth.${env.DOMAIN}`
const apiBase = (env: App['Bindings']): string => `https://api.${env.DOMAIN}`

const app = new Hono<App>()
	.use(
		'*',
		(c, next) =>
			useWorkersLogger(c.env.NAME, {
				environment: c.env.ENVIRONMENT,
				release: c.env.SENTRY_RELEASE,
			})(c, next)
	)

	.onError(withOnError())

	// What the SPA has to know before it can call anything: the hostnames of the two
	// workers it talks to directly. Served rather than baked into the client build so
	// one build works for any operator's domain.
	.get('/api/config', (c) => {
		return c.json({
			hosts: {
				auth: authBase(c.env),
				api: apiBase(c.env),
			},
		})
	})

	// ---- Static SPA ---------------------------------------------------------
	// Everything else is served from the built client assets. With
	// `not_found_handling: single-page-application`, unknown routes return
	// index.html so the React app can handle client-side routing.
	.all('*', (c) => {
		if (!c.env.ASSETS) return c.notFound()
		return c.env.ASSETS.fetch(c.req.raw)
	})

export default app
