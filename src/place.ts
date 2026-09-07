/**
 * Where a note goes: base folder + folder template (or a per-notebook
 * override) + filename template, every segment made safe for the file
 * system and for Obsidian links.
 */
import { App, normalizePath } from 'obsidian';
import { render, Vars } from './render';
import type { ClippingsSettings } from './settings';

/** Characters no file system or Obsidian link tolerates in a name. */
export function safeName(name: string, max = 120): string {
	const cleaned = name
		.replace(/[\\/:*?"<>|#^[\]]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^\.+|\.+$/g, '')
		.trim();
	return (cleaned || 'Untitled').slice(0, max).trim();
}

export function folderFor(vars: Vars, settings: ClippingsSettings): string {
	const notebookId = Number(vars.notebook_id ?? 0);
	const override = settings.folderOverrides[notebookId];
	const sub = override !== undefined ? override : render(settings.folderTemplate, vars);
	const segments = [settings.baseFolder, ...sub.split('/')]
		.map((s) => safeName(s, 80))
		.filter((s) => s && s !== 'Untitled');
	return normalizePath(segments.join('/'));
}

export function filenameFor(vars: Vars, settings: ClippingsSettings): string {
	return safeName(render(settings.filenameTemplate, vars)) + '.md';
}

export async function ensureFolder(app: App, path: string): Promise<void> {
	const parts = path.split('/');
	let current = '';
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			try {
				await app.vault.createFolder(current);
			} catch (e) {
				// Two syncs, or a folder that appeared meanwhile: fine if it exists now.
				if (!app.vault.getAbstractFileByPath(current)) throw e;
			}
		}
	}
}

/**
 * `folder/name.md`, or `folder/name (2).md` … when something else already
 * has that name. Compared case-insensitively: macOS and Windows file systems
 * are, and Obsidian's index is not, so "Foo.md" beside "foo.md" would pass
 * the index and fail the write.
 */
export function uniquePath(app: App, folder: string, filename: string): string {
	const taken = new Set(
		(app.vault.getFolderByPath(folder)?.children ?? []).map((f) => f.name.toLowerCase()),
	);
	const stem = filename.replace(/\.md$/, '');
	let name = filename;
	let n = 2;
	while (taken.has(name.toLowerCase())) {
		name = `${stem} (${n}).md`;
		n++;
	}
	return normalizePath(`${folder}/${name}`);
}
