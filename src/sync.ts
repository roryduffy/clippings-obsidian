/**
 * The loop: pull what this vault is owed, write each clip as a note, tell
 * the server which ones landed. One run at a time; a page is acked before
 * the next is fetched so a crash mid-sync loses at most one page of acks
 * (and the ledger reconcile on the next run catches even those).
 */
import { Notice, TFile } from 'obsidian';
import type ClippingsPlugin from './main';
import { ApiError, Offline, SignedOut } from './api';
import { Ledger } from './ledger';
import { ensureFolder, filenameFor, folderFor, uniquePath } from './place';
import { DEFAULT_NOTE_TEMPLATE, render, variables } from './render';
import type { Clip } from './types';

const PAGE = 50;

export interface SyncResult {
	written: number;
	updated: number; // an existing note rewritten under the policy
	skipped: number; // already in the vault and left alone
	failed: number;
	error?: string; // a run-level failure (signed out, server down)
	status?: string; // the status-bar line for that failure
}

async function sha256(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Syncer {
	private running = false;

	constructor(private plugin: ClippingsPlugin) {}

	get isRunning(): boolean {
		return this.running;
	}

	async run(opts: { manual: boolean }): Promise<SyncResult> {
		const result: SyncResult = { written: 0, updated: 0, skipped: 0, failed: 0 };
		if (this.running) {
			if (opts.manual) new Notice('Clippings is already syncing.');
			return result;
		}
		if (!this.plugin.isConnected()) {
			if (opts.manual) new Notice('Connect Clippings in the plugin settings first.');
			return result;
		}
		this.running = true;
		this.plugin.setStatus('Clippings: syncing…');
		try {
			const s = this.plugin.settings;
			const ledger = new Ledger(this.plugin.app, s);
			ledger.reconcile();
			const since = s.syncHistory ? undefined : s.connectedAt || undefined;
			let after = 0;
			for (;;) {
				const page = await this.plugin.api.clips(s.vaultKey, after, PAGE, since);
				const ok: number[] = [];
				const failed: { id: number; error: string }[] = [];
				for (const clip of page.clips) {
					try {
						result[await this.place(clip, ledger)]++;
						ok.push(clip.id);
					} catch (e) {
						result.failed++;
						failed.push({ id: clip.id, error: (e as Error).message.slice(0, 300) });
						console.error(`Clippings: could not write clip ${clip.id}`, e);
					}
				}
				await this.plugin.saveSettings(); // the ledger, before the ack
				if (ok.length || failed.length) await this.plugin.api.ack(s.vaultKey, ok, failed);
				if (page.next === null || page.clips.length === 0) break;
				after = page.next;
			}
		} catch (e) {
			result.error =
				e instanceof SignedOut
					? 'Clippings is disconnected. Connect again in the plugin settings.'
					: e instanceof Offline
						? e.message
						: e instanceof ApiError
							? e.message
							: `Clippings could not sync: ${(e as Error).message}`;
			result.status = e instanceof SignedOut ? 'Clippings: disconnected' : e instanceof Offline ? 'Clippings: offline' : 'Clippings: sync failed';
		} finally {
			this.running = false;
		}
		this.report(result, opts.manual);
		return result;
	}

	/**
	 * Write a clip that is new to this vault, or apply the existing-note
	 * policy to one that is already here. Returns which counter to bump.
	 */
	async place(clip: Clip, ledger: Ledger): Promise<'written' | 'updated' | 'skipped'> {
		const s = this.plugin.settings;
		const app = this.plugin.app;
		const vars = variables(clip);
		vars.notebook_id = clip.notebook_id;
		const body = render(s.noteTemplate.trim() ? s.noteTemplate : DEFAULT_NOTE_TEMPLATE, vars);
		const existing = ledger.file(clip.id);
		if (existing) {
			const current = await app.vault.read(existing);
			if (current === body) return 'skipped'; // nothing would change
			const unedited = s.hashes[clip.id] !== undefined && s.hashes[clip.id] === (await sha256(current));
			if (s.existingNote === 'overwrite' || (s.existingNote === 'overwrite-if-unedited' && unedited)) {
				await app.vault.modify(existing, body);
				s.hashes[clip.id] = await sha256(body);
				return 'updated';
			}
			return 'skipped';
		}
		const folder = folderFor(vars, s);
		await ensureFolder(app, folder);
		const path = uniquePath(app, folder, filenameFor(vars, s));
		await app.vault.create(path, body);
		ledger.record(clip.id, path);
		s.hashes[clip.id] = await sha256(body);
		return 'written';
	}

	/**
	 * "Re-render notes": every note in the ledger, fetched again and passed
	 * through place() so the current template and policy decide. Notes the
	 * user edited are only touched under the Overwrite policy.
	 */
	async rerender(): Promise<SyncResult> {
		const result: SyncResult = { written: 0, updated: 0, skipped: 0, failed: 0 };
		if (this.running) {
			new Notice('Clippings is already syncing.');
			return result;
		}
		if (!this.plugin.isConnected()) {
			new Notice('Connect Clippings in the plugin settings first.');
			return result;
		}
		const s = this.plugin.settings;
		if (s.existingNote === 'skip') {
			new Notice('Re-rendering changes nothing while existing notes are left alone. Change that setting to overwrite unedited notes first.', 10_000);
			return result;
		}
		this.running = true;
		this.plugin.setStatus('Clippings: re-rendering…');
		try {
			const ledger = new Ledger(this.plugin.app, s);
			ledger.reconcile();
			for (const [key, path] of Object.entries(s.written)) {
				const id = Number(key);
				if (!(this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile)) continue;
				try {
					const clip = await this.plugin.api.clip(s.vaultKey, id);
					result[await this.place(clip, ledger)]++;
				} catch (e) {
					if (e instanceof SignedOut) throw e;
					result.failed++;
					console.error(`Clippings: could not re-render clip ${id}`, e);
				}
			}
			await this.plugin.saveSettings();
		} catch (e) {
			result.error =
				e instanceof SignedOut
					? 'Clippings is disconnected. Connect again in the plugin settings.'
					: e instanceof Offline
						? e.message
						: `Clippings could not re-render: ${(e as Error).message}`;
		} finally {
			this.running = false;
		}
		if (result.error) {
			this.plugin.setStatus('Clippings: re-render failed');
			new Notice(result.error, 8000);
		} else {
			const line = `${result.updated} note${result.updated === 1 ? '' : 's'} updated, ${result.skipped} left alone${result.failed ? `, ${result.failed} failed` : ''}.`;
			this.plugin.setStatus(`Clippings: ${result.updated} re-rendered`);
			new Notice(line, 8000);
		}
		return result;
	}

	private report(r: SyncResult, manual: boolean): void {
		if (r.error) {
			// Quiet unless asked: a laptop that is offline every fifteen
			// minutes should not say so every fifteen minutes.
			this.plugin.setStatus(r.status ?? 'Clippings: sync failed');
			if (manual) new Notice(r.error, 8000);
			return;
		}
		const parts: string[] = [];
		if (r.written) parts.push(`${r.written} new note${r.written === 1 ? '' : 's'}`);
		if (r.updated) parts.push(`${r.updated} updated`);
		if (r.failed) parts.push(`${r.failed} could not be written`);
		this.plugin.setStatus(parts.length ? `Clippings: ${parts.join(', ')}` : 'Clippings: up to date');
		if (manual || parts.length) {
			new Notice(parts.length ? `Clippings: ${parts.join(', ')}.` : 'Clippings: nothing new to sync.');
		}
	}
}
