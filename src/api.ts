/**
 * The HTTP client for /api. `requestUrl` rather than `fetch`: Obsidian's
 * origin is app://obsidian.md and the server does not answer CORS for it,
 * while requestUrl goes through the app and is exempt — and it is the same
 * call on desktop and mobile.
 *
 * One rule: a 401 refreshes once and retries; a second 401 means the
 * sign-in is gone, and the caller gets SignedOut so the UI can show
 * Connect again instead of a wall of errors.
 */
import { requestUrl } from 'obsidian';
import { AuthStore, Tokens } from './auth';
import type { Clip, ClipsPage } from './types';

export class SignedOut extends Error {
	constructor() {
		super('Not connected to Clippings.');
	}
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

export interface Me {
	id: number;
	email: string;
	plan: string;
	plan_label: string;
}

export class ApiClient {
	constructor(private auth: AuthStore) {}

	private async call<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
		let tokens: Tokens | null = this.auth.load();
		if (!tokens) throw new SignedOut();
		if (tokens.expiresAt - Date.now() < 60_000 && !retried) {
			// Expiring within a minute: refresh proactively rather than
			// spending a round trip on the 401.
			tokens = await this.refreshOrSignOut();
		}
		const res = await requestUrl({
			url: `${tokens.server}${path}`,
			method,
			headers: { Authorization: `Bearer ${tokens.access}`, Accept: 'application/json' },
			contentType: body === undefined ? undefined : 'application/json',
			body: body === undefined ? undefined : JSON.stringify(body),
			throw: false,
		});
		if (res.status === 401 && !retried) {
			await this.refreshOrSignOut();
			return this.call<T>(method, path, body, true);
		}
		if (res.status === 204) return undefined as T;
		if (res.status >= 400) {
			const detail = (res.json as { detail?: string } | null)?.detail;
			throw new ApiError(res.status, detail ?? `Clippings answered ${res.status}.`);
		}
		return res.json as T;
	}

	private async refreshOrSignOut(): Promise<Tokens> {
		try {
			return await this.auth.refresh();
		} catch {
			throw new SignedOut();
		}
	}

	me(): Promise<Me> {
		return this.call<Me>('GET', '/api/me');
	}

	registerVault(vaultKey: string, name: string): Promise<{ vault_id: number }> {
		return this.call('POST', '/api/obsidian/vaults', { vault_key: vaultKey, name });
	}

	clips(vaultKey: string, after: number, limit: number, since?: number): Promise<ClipsPage> {
		const q = new URLSearchParams({ vault: vaultKey, after: String(after), limit: String(limit) });
		if (since) q.set('since', String(since));
		return this.call<ClipsPage>('GET', `/api/obsidian/clips?${q.toString()}`);
	}

	ack(vaultKey: string, ok: number[], failed: { id: number; error: string }[]): Promise<{ acknowledged: number }> {
		return this.call('POST', '/api/obsidian/ack', { vault_key: vaultKey, ok, failed });
	}

	/** Server-side disconnect for this vault's sign-in. */
	disconnectVault(vaultKey: string): Promise<void> {
		return this.call<void>('DELETE', `/api/obsidian/vaults/${encodeURIComponent(vaultKey)}`);
	}
}

export type { Clip };
