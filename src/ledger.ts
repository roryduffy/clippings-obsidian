/**
 * Which clip became which note. The map lives in data.json (settings.written)
 * and is kept true three ways, none of which enumerates the vault:
 *
 * - Obsidian's rename and delete events (registered in main.ts) follow a
 *   note the user moves or renames anywhere, and forget one they delete.
 * - `reconcile()` walks only the Clippings base folder, reading
 *   `clippings_id` from the metadata cache, so a fresh install into a vault
 *   that already holds Clippings notes picks them up instead of writing
 *   them twice, and a note that vanished while the plugin was not running
 *   is dropped.
 * - Every entry is checked to still exist before it is trusted.
 */
import { App, TFile, TFolder } from 'obsidian';
import type { ClippingsSettings } from './settings';

export class Ledger {
	constructor(
		private app: App,
		private settings: ClippingsSettings,
	) {}

	/** Rebuild from frontmatter under the base folder, then merge with what we already knew. */
	reconcile(): void {
		const found: Record<number, string> = {};
		const root = this.app.vault.getFolderByPath(this.settings.baseFolder);
		if (root) {
			for (const file of markdownFilesUnder(root)) {
				const id = this.app.metadataCache.getFileCache(file)?.frontmatter?.clippings_id as unknown;
				const n = typeof id === 'number' ? id : typeof id === 'string' ? parseInt(id, 10) : NaN;
				if (Number.isFinite(n) && !(n in found)) found[n] = file.path;
			}
		}
		// Keep entries only for notes that still exist; prefer the vault's word on where they are.
		const merged: Record<number, string> = {};
		for (const [k, path] of Object.entries(this.settings.written)) {
			const id = Number(k);
			if (id in found) merged[id] = found[id]!;
			else if (this.app.vault.getFileByPath(path)) merged[id] = path;
		}
		for (const [k, path] of Object.entries(found)) merged[Number(k)] = path;
		this.settings.written = merged;
	}

	has(clipId: number): boolean {
		return clipId in this.settings.written;
	}

	file(clipId: number): TFile | null {
		const path = this.settings.written[clipId];
		return path ? this.app.vault.getFileByPath(path) : null;
	}

	record(clipId: number, path: string): void {
		this.settings.written[clipId] = path;
	}

	/** A note (or a folder of them) was moved or renamed: follow it. Returns whether anything changed. */
	follow(oldPath: string, newPath: string): boolean {
		let changed = false;
		for (const [k, path] of Object.entries(this.settings.written)) {
			if (path === oldPath) {
				this.settings.written[Number(k)] = newPath;
				changed = true;
			} else if (path.startsWith(oldPath + '/')) {
				this.settings.written[Number(k)] = newPath + path.slice(oldPath.length);
				changed = true;
			}
		}
		return changed;
	}

	/** A note (or a folder of them) was deleted: forget it. Returns whether anything changed. */
	forget(path: string): boolean {
		let changed = false;
		for (const [k, p] of Object.entries(this.settings.written)) {
			if (p === path || p.startsWith(path + '/')) {
				delete this.settings.written[Number(k)];
				delete this.settings.hashes[Number(k)];
				changed = true;
			}
		}
		return changed;
	}
}

function* markdownFilesUnder(folder: TFolder): Generator<TFile> {
	for (const child of folder.children) {
		if (child instanceof TFolder) yield* markdownFilesUnder(child);
		else if (child instanceof TFile && child.extension === 'md') yield child;
	}
}
