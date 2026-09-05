/**
 * The loop: pull what this vault is owed, write each clip as a note, tell
 * the server which ones landed. One run at a time; a page is acked before
 * the next is fetched so a crash mid-sync loses at most one page of acks
 * (and the ledger reconcile on the next run catches even those).
 */
import { Notice } from 'obsidian';
import type ClippingsPlugin from './main';
import { ApiError, SignedOut } from './api';
import { Ledger } from './ledger';
import { ensureFolder, filenameFor, folderFor, uniquePath } from './place';
import { DEFAULT_NOTE_TEMPLATE, render, variables } from './render';
import type { Clip } from './types';

const PAGE = 50;

export interface SyncResult {
	written: number;
	skipped: number; // already in the vault
	failed: number;
	error?: string; // a run-level failure (signed out, server down)
}

export class Syncer {
	private running = false;

	constructor(private plugin: ClippingsPlugin) {}

	get isRunning(): boolean {
		return this.running;
	}

	async run(opts: { manual: boolean }): Promise<SyncResult> {
		const result: SyncResult = { written: 0, skipped: 0, failed: 0 };
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
						if (ledger.has(clip.id) && ledger.file(clip.id)) {
							result.skipped++;
						} else {
							await this.write(clip, ledger);
							result.written++;
						}
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
					: e instanceof ApiError
						? e.message
						: `Clippings could not sync: ${(e as Error).message}`;
		} finally {
			this.running = false;
		}
		this.report(result, opts.manual);
		return result;
	}

	private async write(clip: Clip, ledger: Ledger): Promise<void> {
		const s = this.plugin.settings;
		const vars = variables(clip);
		vars.notebook_id = clip.notebook_id;
		const folder = folderFor(vars, s);
		await ensureFolder(this.plugin.app, folder);
		const path = uniquePath(this.plugin.app, folder, filenameFor(vars, s));
		const body = render(s.noteTemplate.trim() ? s.noteTemplate : DEFAULT_NOTE_TEMPLATE, vars);
		await this.plugin.app.vault.create(path, body);
		ledger.record(clip.id, path);
	}

	private report(r: SyncResult, manual: boolean): void {
		if (r.error) {
			this.plugin.setStatus('Clippings: sync failed');
			if (manual) new Notice(r.error, 8000);
			return;
		}
		const summary = r.written ? `Clippings: ${r.written} new note${r.written === 1 ? '' : 's'}` : 'Clippings: up to date';
		this.plugin.setStatus(summary + (r.failed ? `, ${r.failed} failed` : ''));
		if (manual || r.written || r.failed) {
			new Notice(
				r.written || r.failed
					? `${summary.replace('Clippings: ', '')}${r.failed ? `, ${r.failed} could not be written` : ''}.`
					: 'Clippings: nothing new to sync.',
			);
		}
	}
}
