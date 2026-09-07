/**
 * Sign-in: OAuth 2.1 authorization code + PKCE against Clippings' own
 * provider, as a fixed first-party client. The browser does the sign-in and
 * comes back through `obsidian://clippings-auth`, which Obsidian routes to the
 * protocol handler registered in main.ts.
 *
 * Tokens live in Obsidian's per-device local storage (App.saveLocalStorage),
 * never in data.json: data.json travels with the vault through Sync, iCloud
 * or git, and a synced credential is a leaked credential. A vault opened on a
 * second device therefore connects separately — each device is its own
 * sign-in on the Clippings settings page, and can be revoked on its own.
 */
import { App, Platform, requestUrl } from 'obsidian';

export const CLIENT_ID = 'clippings-obsidian';
export const REDIRECT_URI = 'obsidian://clippings-auth';
export const PROTOCOL_ACTION = 'clippings-auth';
const STORE_KEY = 'clippings-auth';
const PENDING_KEY = 'clippings-auth-pending';

export interface Tokens {
	access: string;
	refresh: string;
	expiresAt: number; // unix ms
	server: string; // the server these tokens belong to
	email?: string;
	planLabel?: string;
}

interface Pending {
	verifier: string;
	state: string;
	server: string;
	startedAt: number;
}

/** The server answered and said no (`rejected`), or could not be reached. */
export class AuthError extends Error {
	constructor(
		message: string,
		public rejected = false,
	) {
		super(message);
	}
}

/** requestUrl threw before any HTTP answer: offline, DNS, refused. */
export function isNetworkError(e: unknown): boolean {
	return !(e instanceof AuthError) && e instanceof Error && !('status' in e);
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
	const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	let s = '';
	for (const b of arr) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkce(): Promise<{ verifier: string; challenge: string }> {
	const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return { verifier, challenge: base64url(digest) };
}

export function deviceName(app: App): string {
	const where = Platform.isIosApp
		? 'iPhone'
		: Platform.isAndroidApp
			? 'Android'
			: Platform.isMacOS
				? 'Mac'
				: Platform.isWin
					? 'Windows'
					: 'Linux';
	return `${app.vault.getName()} on ${where}`.slice(0, 40);
}

export class AuthStore {
	constructor(private app: App) {}

	load(): Tokens | null {
		const raw = this.app.loadLocalStorage(STORE_KEY) as Tokens | null;
		return raw && typeof raw.access === 'string' ? raw : null;
	}

	save(tokens: Tokens | null): void {
		this.app.saveLocalStorage(STORE_KEY, tokens);
	}

	/**
	 * Step one: remember the verifier and open the browser. The pending
	 * record is also written to local storage so a callback that arrives
	 * after Obsidian was restarted mid-flow still completes.
	 */
	async begin(server: string): Promise<void> {
		const { verifier, challenge } = await pkce();
		const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
		const pending: Pending = { verifier, state, server, startedAt: Date.now() };
		this.app.saveLocalStorage(PENDING_KEY, pending);
		const params = new URLSearchParams({
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			response_type: 'code',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			scope: 'clips:read clips:write',
			state,
		});
		window.open(`${server}/oauth/obsidian/authorize?${params.toString()}`);
	}

	/**
	 * Step two: the protocol handler hands over the callback's parameters.
	 * Exchanges the code and stores the tokens. Throws AuthError with a
	 * sentence fit for a Notice.
	 */
	async complete(params: Record<string, string>): Promise<Tokens> {
		const pending = this.app.loadLocalStorage(PENDING_KEY) as Pending | null;
		this.app.saveLocalStorage(PENDING_KEY, null);
		if (!pending || Date.now() - pending.startedAt > 15 * 60 * 1000) {
			throw new AuthError('That sign-in took too long or was not started from this vault. Press Connect again.');
		}
		if (params.error) {
			throw new AuthError(
				params.error === 'access_denied'
					? 'Sign-in was cancelled.'
					: `Clippings refused the sign-in (${params.error_description ?? params.error}).`,
			);
		}
		if (!params.code || params.state !== pending.state) {
			throw new AuthError('The sign-in reply did not match this vault. Press Connect again.');
		}
		const tokens = await exchange(pending.server, {
			grant_type: 'authorization_code',
			code: params.code,
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			code_verifier: pending.verifier,
			device_name: deviceName(this.app),
		});
		this.save(tokens);
		return tokens;
	}

	/** Rotates both halves. When the server *rejects* the refresh the stored
	 * tokens are cleared — it has already forgotten them, and keeping a dead
	 * pair only makes every later call fail the same way. When the server
	 * cannot be reached at all they are kept: a laptop on a train is not a
	 * revoked sign-in, and the next successful call refreshes normally. */
	async refresh(): Promise<Tokens> {
		const current = this.load();
		if (!current) throw new AuthError('Not connected.', true);
		try {
			const tokens = await exchange(current.server, {
				grant_type: 'refresh_token',
				refresh_token: current.refresh,
				client_id: CLIENT_ID,
			});
			tokens.email = current.email;
			tokens.planLabel = current.planLabel;
			this.save(tokens);
			return tokens;
		} catch (e) {
			if (e instanceof AuthError && e.rejected) this.save(null);
			throw e;
		}
	}

	/** Tells the server to forget this sign-in, then forgets it locally.
	 * Local first would strand a live token on the server if the network
	 * call failed; the order here means a failed revoke is retried simply by
	 * pressing Disconnect again. */
	async revoke(): Promise<void> {
		const current = this.load();
		if (!current) return;
		await requestUrl({
			url: `${current.server}/oauth/obsidian/revoke`,
			method: 'POST',
			contentType: 'application/x-www-form-urlencoded',
			body: new URLSearchParams({ token: current.refresh }).toString(),
			throw: false,
		});
		this.save(null);
	}
}

async function exchange(server: string, form: Record<string, string>): Promise<Tokens> {
	const res = await requestUrl({
		url: `${server}/oauth/obsidian/token`,
		method: 'POST',
		contentType: 'application/x-www-form-urlencoded',
		body: new URLSearchParams(form).toString(),
		throw: false,
	});
	if (res.status !== 200) {
		const code = (res.json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
		// 5xx is the server having a bad moment, not a verdict on the tokens.
		throw new AuthError(`Clippings did not accept the sign-in (${code}).`, res.status < 500);
	}
	const body = res.json as { access_token: string; refresh_token: string; expires_in: number };
	return {
		access: body.access_token,
		refresh: body.refresh_token,
		expiresAt: Date.now() + body.expires_in * 1000,
		server,
	};
}
