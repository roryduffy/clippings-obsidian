/**
 * Which clip became which note. The map lives in data.json (settings.written)
 * for speed and is reconciled against the vault's metadata cache on every
 * sync, so a note the user moved or renamed is still found, a note they
 * deleted is forgotten, and a fresh install into a vault that already holds
 * Clippings notes picks them up instead of writing them twice.
 */
import { App, TFile } from 'obsidian';
import type { ClippingsSettings } from './settings';

export class Ledger {
	constructor(
		private app: App,
		private settings: ClippingsSettings,
	) {}

	/** Rebuild from frontmatter `clippings_id` across the vault, then merge. */
	reconcile(): void {
		const found: Record<number, string> = {};
		for (const file of this.app.vault.getMarkdownFiles()) {
			const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.clippings_id as unknown;
			const n = typeof id === 'number' ? id : typeof id === 'string' ? parseInt(id, 10) : NaN;
			if (Number.isFinite(n) && !(n in found)) found[n] = file.path;
		}
		// Keep entries only for notes that still exist; prefer the vault's word on where they are.
		const merged: Record<number, string> = {};
		for (const [k, path] of Object.entries(this.settings.written)) {
			const id = Number(k);
			if (id in found) merged[id] = found[id]!;
			else if (this.app.vault.getAbstractFileByPath(path)) merged[id] = path;
		}
		for (const [k, path] of Object.entries(found)) merged[Number(k)] = path;
		this.settings.written = merged;
	}

	has(clipId: number): boolean {
		return clipId in this.settings.written;
	}

	file(clipId: number): TFile | null {
		const path = this.settings.written[clipId];
		if (!path) return null;
		const f = this.app.vault.getAbstractFileByPath(path);
		return f instanceof TFile ? f : null;
	}

	record(clipId: number, path: string): void {
		this.settings.written[clipId] = path;
	}
}
