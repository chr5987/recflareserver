import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

import type { Env } from '../../context'

declare module 'cloudflare:test' {
	interface ProvidedEnv extends Env {}
}

// This is the one thing the admin worker serves outside the SPA: where `auth`/`api`
// live, so the built client can call them directly (same pattern `www` uses). Pinned so
// a future refactor can't silently drop a host the dashboard needs.
it('advertises where auth and api live', async () => {
	const res = await SELF.fetch('https://example.com/api/config')
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({
		hosts: {
			auth: 'https://auth.rec.example.com',
			api: 'https://api.rec.example.com',
		},
	})
})
