import { useCallback, useEffect, useState } from 'react'

import type { FormEvent } from 'react'

/**
 * The admin SPA calls `auth` and `api` DIRECTLY (same pattern `www` uses for the rest of
 * the game's endpoints) rather than proxying through this worker — both already answer
 * CORS (`withDefaultCors()`), and the access token lives here in the browser.
 *
 * Every admin endpoint independently checks the token's `role` claim for `developer` and
 * refuses (403) anyone else; the `isDeveloper()` check below is UX only — it decides
 * whether to show the dashboard, never whether a call is allowed to succeed.
 */

/** Where `auth`/`api` live. From `/api/config`, never baked into this build. */
interface Hosts {
	auth: string
	api: string
}

/** The account fields the admin routes serve — never the full account blob. */
interface AdminAccount {
	accountId: number
	username: string
	displayName: string
	createdAt: string
	isDeveloper: boolean
	isModerator: boolean
}

/** A stored `report` row, as `api`'s admin ban routes answer it. */
interface ReportRow {
	id: number
	reporter_player_id: number
	reported_player_id: number
	details: string | null
	created_at: string
	banned: number
	ban_expires: string | null
}

/**
 * RecNet (4) is the web platform, stamped as the token's `platform` claim on sign-in —
 * same constant `www`'s sign-in form uses.
 */
const WEB_PLATFORM = '4'

/**
 * The session's access token, in localStorage so a reload stays signed in. A distinct
 * key from `www`'s (`rf_token`) in case both are ever run on the same host during local
 * dev — each worker's SPA should only ever see its own session.
 */
const TOKEN_KEY = 'rf_admin_token'
let token: string | null = localStorage.getItem(TOKEN_KEY)

function setToken(next: string | null) {
	token = next
	if (next === null) localStorage.removeItem(TOKEN_KEY)
	else localStorage.setItem(TOKEN_KEY, next)
}

/** Filled in once `/api/config` lands, before any worker call is made. */
let hosts: Hosts | null = null

function where(): Hosts {
	if (hosts === null) throw new Error('Still starting up — please reload the page.')
	return hosts
}

/**
 * Decodes the `role` claim from the session token WITHOUT verifying it — a page holds no
 * signing key, and faking one here only reveals a dashboard whose endpoints reject the
 * same token. A malformed or missing token reads as no roles.
 */
function decodeRoles(): string[] {
	const payload = token?.split('.')[1]
	if (!payload) return []
	try {
		const b64 = payload.replace(/-/g, '+').replace(/_/g, '/')
		const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')
		const claims = JSON.parse(atob(padded)) as { role?: unknown }
		return Array.isArray(claims.role) ? claims.role.filter((r): r is string => typeof r === 'string') : []
	} catch {
		return []
	}
}

/** This worker is developer-gated, not the broader admin-role set `www`/`notify` use — a
 * moderator-only account authenticates fine but is refused entry here. */
const isDeveloper = () => decodeRoles().includes('developer')

/**
 * An OAuth machine code (`invalid_grant`, `server_error`) rather than a sentence — see
 * `www`'s `App.tsx` for the identical helper.
 */
const isErrorCode = (s: string) => /^[a-z][a-z\d]*(_[a-z\d]+)+$/.test(s)

function errorMessage(data: Record<string, unknown>, status: number): string {
	const error = typeof data.error === 'string' ? data.error : ''
	const description = typeof data.error_description === 'string' ? data.error_description : ''
	return (
		(error && !(isErrorCode(error) && description) && error) ||
		description ||
		error ||
		`Request failed (${status})`
	)
}

interface CallOptions {
	method?: 'GET' | 'POST'
	form?: Record<string, string>
	json?: unknown
	authed?: boolean
}

/** Call a worker. Returns the parsed body, or throws with something worth showing. */
async function call<T = Record<string, unknown>>(url: string, opts: CallOptions = {}): Promise<T> {
	const headers: Record<string, string> = {}
	if (opts.authed && token) headers.authorization = `Bearer ${token}`
	let body: string | undefined
	if (opts.form) {
		headers['content-type'] = 'application/x-www-form-urlencoded'
		body = new URLSearchParams(opts.form).toString()
	} else if (opts.json !== undefined) {
		headers['content-type'] = 'application/json'
		body = JSON.stringify(opts.json)
	}

	const res = await fetch(url, {
		method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
		headers,
		body,
	})
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>

	if (!res.ok) {
		if (res.status === 401 && opts.authed) {
			setToken(null)
			throw new Error('Your session has expired. Please sign in again.')
		}
		throw new Error(errorMessage(data, res.status))
	}
	return data as T
}

function useAction() {
	const [pending, setPending] = useState(false)
	const [error, setError] = useState('')

	const run = useCallback(async (fn: () => Promise<void>) => {
		setPending(true)
		setError('')
		try {
			await fn()
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setPending(false)
		}
	}, [])

	return { pending, error, run }
}

async function signIn(username: string, password: string): Promise<void> {
	const data = await call<{ access_token?: string }>(`${where().auth}/connect/token`, {
		form: { grant_type: 'password', platform: WEB_PLATFORM, username, password },
	})
	if (!data.access_token) throw new Error('Sign-in did not return a token.')
	setToken(data.access_token)
}

function LoginForm({ onSignedIn }: { onSignedIn: () => void }) {
	const [username, setUsername] = useState('')
	const [password, setPassword] = useState('')
	const { pending, error, run } = useAction()

	const submit = (e: FormEvent) => {
		e.preventDefault()
		run(async () => {
			await signIn(username, password)
			onSignedIn()
		})
	}

	return (
		<div className="shell">
			<div className="brand">
				<h1>
					RecFlare <span>Admin</span>
				</h1>
			</div>
			<form className="card" onSubmit={submit}>
				<div className="field">
					<label htmlFor="username">Username</label>
					<input
						id="username"
						value={username}
						onChange={(e) => setUsername(e.target.value)}
						autoComplete="username"
						required
					/>
				</div>
				<div className="field">
					<label htmlFor="password">Password</label>
					<input
						id="password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						autoComplete="current-password"
						required
					/>
				</div>
				{error && <p className="error">{error}</p>}
				<button className="btn" type="submit" disabled={pending}>
					{pending ? 'Signing in…' : 'Sign in'}
				</button>
			</form>
		</div>
	)
}

function AccessDenied({ onSignOut }: { onSignOut: () => void }) {
	return (
		<div className="shell">
			<div className="brand">
				<h1>
					RecFlare <span>Admin</span>
				</h1>
			</div>
			<div className="card">
				<p>Developer access is required to use this dashboard.</p>
				<p className="muted">
					Your account signed in successfully, but only the <code>developer</code> role can
					reach the player tools here. A developer can grant you the role from this same
					dashboard.
				</p>
				<button className="btn secondary" onClick={onSignOut}>
					Sign out
				</button>
			</div>
		</div>
	)
}

/** One search result row: role toggles plus an expandable ban panel. */
function PlayerRow({ account, onChanged }: { account: AdminAccount; onChanged: (a: AdminAccount) => void }) {
	const [banExpanded, setBanExpanded] = useState(false)
	const roleAction = useAction()

	const toggleRole = (role: 'developer' | 'moderator', grant: boolean) => {
		roleAction.run(async () => {
			const updated = await call<AdminAccount>(
				`${where().auth}/admin/accounts/${account.accountId}/roles`,
				{ authed: true, json: { role, grant } }
			)
			onChanged(updated)
		})
	}

	return (
		<div className="player-row">
			<header>
				<div>
					<strong>{account.displayName}</strong> <span className="muted">@{account.username}</span>
					{account.isDeveloper && <span className="tag developer">developer</span>}
					{account.isModerator && <span className="tag moderator">moderator</span>}
				</div>
				<div className="row-actions">
					<button
						className="btn secondary"
						disabled={roleAction.pending}
						onClick={() => toggleRole('developer', !account.isDeveloper)}
					>
						{account.isDeveloper ? 'Revoke developer' : 'Grant developer'}
					</button>
					<button
						className="btn secondary"
						disabled={roleAction.pending}
						onClick={() => toggleRole('moderator', !account.isModerator)}
					>
						{account.isModerator ? 'Revoke moderator' : 'Grant moderator'}
					</button>
					<button className="btn secondary" onClick={() => setBanExpanded((v) => !v)}>
						{banExpanded ? 'Hide ban tools' : 'Ban tools'}
					</button>
				</div>
			</header>
			<p className="muted">
				#{account.accountId} · joined {new Date(account.createdAt).toLocaleDateString()}
			</p>
			{roleAction.error && <p className="error">{roleAction.error}</p>}
			{banExpanded && <BanPanel playerId={account.accountId} />}
		</div>
	)
}

/** Fetches and shows the active ban (if any) for a player, with ban/lift controls. */
function BanPanel({ playerId }: { playerId: number }) {
	const [activeBan, setActiveBan] = useState<ReportRow | null | undefined>(undefined)
	const [reason, setReason] = useState('')
	const [durationDays, setDurationDays] = useState('')
	const [permanent, setPermanent] = useState(true)
	const loadAction = useAction()
	const banAction = useAction()

	const load = useCallback(() => {
		loadAction.run(async () => {
			const data = await call<{ activeBan: ReportRow | null; reports: ReportRow[] }>(
				`${where().api}/admin/bans/${playerId}`,
				{ authed: true }
			)
			setActiveBan(data.activeBan)
		})
	}, [playerId]) // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		load()
	}, [load])

	const ban = () => {
		banAction.run(async () => {
			const data = await call<{ activeBan: ReportRow | null }>(`${where().api}/admin/bans/${playerId}`, {
				authed: true,
				json: {
					reason: reason || undefined,
					permanent,
					durationDays: permanent ? undefined : Number.parseInt(durationDays, 10) || undefined,
				},
			})
			setActiveBan(data.activeBan)
		})
	}

	const lift = () => {
		banAction.run(async () => {
			await call<{ liftedBan: ReportRow | null }>(`${where().api}/admin/bans/${playerId}/lift`, {
				authed: true,
				method: 'POST',
			})
			setActiveBan(null)
		})
	}

	return (
		<div className="ban-panel">
			{loadAction.pending && <p className="muted">Loading ban status…</p>}
			{loadAction.error && <p className="error">{loadAction.error}</p>}
			{activeBan !== undefined && activeBan !== null && (
				<p>
					<span className="tag banned">banned</span>{' '}
					{activeBan.ban_expires
						? `until ${new Date(activeBan.ban_expires).toLocaleString()}`
						: 'permanently'}
					{activeBan.details ? ` — ${activeBan.details}` : ''}
				</p>
			)}
			{activeBan === null && <p className="muted">Not currently banned.</p>}

			{activeBan ? (
				<button className="btn secondary" disabled={banAction.pending} onClick={lift}>
					Lift ban
				</button>
			) : (
				<>
					<div className="field">
						<label>Reason</label>
						<input value={reason} onChange={(e) => setReason(e.target.value)} />
					</div>
					<label className="muted">
						<input
							type="checkbox"
							checked={permanent}
							onChange={(e) => setPermanent(e.target.checked)}
						/>{' '}
						Permanent
					</label>
					{!permanent && (
						<div className="field">
							<label>Duration (days)</label>
							<input
								type="number"
								min={1}
								value={durationDays}
								onChange={(e) => setDurationDays(e.target.value)}
							/>
						</div>
					)}
					<button className="btn danger" disabled={banAction.pending} onClick={ban}>
						Ban player
					</button>
				</>
			)}
			{banAction.error && <p className="error">{banAction.error}</p>}
		</div>
	)
}

function Dashboard({ onSignOut }: { onSignOut: () => void }) {
	const [query, setQuery] = useState('')
	const [results, setResults] = useState<AdminAccount[]>([])
	const searchAction = useAction()

	const search = (e: FormEvent) => {
		e.preventDefault()
		searchAction.run(async () => {
			const params = new URLSearchParams({ q: query })
			const data = await call<AdminAccount[]>(`${where().auth}/admin/accounts/search?${params}`, {
				authed: true,
			})
			setResults(data)
		})
	}

	const onChanged = (updated: AdminAccount) => {
		setResults((prev) => prev.map((a) => (a.accountId === updated.accountId ? updated : a)))
	}

	return (
		<div className="shell">
			<div className="brand">
				<h1>
					RecFlare <span>Admin</span>
				</h1>
				<button className="btn secondary" style={{ marginLeft: 'auto' }} onClick={onSignOut}>
					Sign out
				</button>
			</div>
			<form className="card" onSubmit={search}>
				<div className="field">
					<label htmlFor="q">Search players by username</label>
					<input
						id="q"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="username prefix…"
					/>
				</div>
				<button className="btn" type="submit" disabled={searchAction.pending}>
					{searchAction.pending ? 'Searching…' : 'Search'}
				</button>
				{searchAction.error && <p className="error">{searchAction.error}</p>}
			</form>
			{results.map((account) => (
				<PlayerRow key={account.accountId} account={account} onChanged={onChanged} />
			))}
			{results.length === 0 && !searchAction.pending && (
				<p className="muted">No results yet — search for a username above.</p>
			)}
		</div>
	)
}

export function App() {
	const [ready, setReady] = useState(false)
	const [signedIn, setSignedIn] = useState(token !== null)

	useEffect(() => {
		fetch('/api/config')
			.then((res) => res.json())
			.then((config: { hosts: Hosts }) => {
				hosts = config.hosts
				setReady(true)
			})
			.catch(() => setReady(true))
	}, [])

	if (!ready) return null

	const onSignOut = () => {
		setToken(null)
		setSignedIn(false)
	}

	if (!signedIn) return <LoginForm onSignedIn={() => setSignedIn(true)} />
	if (!isDeveloper()) return <AccessDenied onSignOut={onSignOut} />
	return <Dashboard onSignOut={onSignOut} />
}
