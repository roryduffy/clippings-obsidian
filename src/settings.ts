import { App, PluginSettingTab, Setting, SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import type ClippingsPlugin from './main';
import { DEFAULT_FILENAME_TEMPLATE, DEFAULT_FOLDER_TEMPLATE, DEFAULT_NOTE_TEMPLATE, render, variables } from './render';
import type { Clip } from './types';

export const DEFAULT_SERVER = 'https://clippingsapp.xyz';

/**
 * What to do when a clip arrives and its note is already in the vault: a
 * fresh install that found notes by their clippings_id, a clip the server
 * offers again after a failed ack, or the "Re-render notes" command.
 */
export type ExistingNotePolicy = 'skip' | 'overwrite-if-unedited' | 'overwrite';

export interface ClippingsSettings {
	/** The Clippings server. Only changed for local development. */
	server: string;
	/** Minted once per vault and never changed: the server keys its per-vault ledger on it. */
	vaultKey: string;
	/** Unix seconds of the first successful connect on this vault — the `since` for "no history". */
	connectedAt: number;
	baseFolder: string;
	folderTemplate: string;
	folderOverrides: Record<number, string>; // notebook_id → folder under the base folder
	filenameTemplate: string;
	noteTemplate: string; // '' means the built-in default
	existingNote: ExistingNotePolicy;
	syncHistory: boolean;
	syncOnLaunch: boolean;
	syncEveryMinutes: number; // 0 = off
	/** clip id → vault path, so a clip is never written twice. */
	written: Record<number, string>;
	/** clip id → sha-256 of what we last wrote, so "unedited" can be told from "edited". */
	hashes: Record<number, string>;
}

export const DEFAULT_SETTINGS: ClippingsSettings = {
	server: DEFAULT_SERVER,
	vaultKey: '',
	connectedAt: 0,
	baseFolder: 'Clippings',
	folderTemplate: DEFAULT_FOLDER_TEMPLATE,
	folderOverrides: {},
	filenameTemplate: DEFAULT_FILENAME_TEMPLATE,
	noteTemplate: '',
	existingNote: 'skip',
	syncHistory: true,
	syncOnLaunch: true,
	syncEveryMinutes: 15,
	written: {},
	hashes: {},
};

/** A clip to validate templates against, so a typo shows up before the next sync does. */
export const SAMPLE_CLIP: Clip = {
	id: 1,
	title: 'How to season a cast-iron pan',
	creator: 'kitchen.notes',
	platform: 'tiktok',
	url: 'https://www.tiktok.com/@kitchen.notes/video/1',
	clippings_url: 'https://clippingsapp.xyz/clips/1',
	notebook: 'Cooking',
	notebook_id: 1,
	note: 'For the new pan.',
	takeaways: ['Thin layers of oil', 'Bake upside down'],
	transcript: 'Start with a clean, dry pan…',
	transcript_method: 'Captions',
	caption: '',
	media_kind: 'video',
	slide_count: null,
	duration: 58,
	thumbnail_url: null,
	saved_at: new Date().toISOString(),
	completed_at: new Date().toISOString(),
};

/** '' when the template renders; otherwise the engine's complaint. */
export function templateError(template: string): string {
	try {
		render(template, variables(SAMPLE_CLIP));
		return '';
	} catch (e) {
		return (e as Error).message;
	}
}

const VARIABLES =
	'title, creator, platform, platform_label, url, clippings_url, notebook, note, takeaways, transcript, ' +
	'transcript_method, caption, media_kind, carousel, slide_count, duration, duration_label, thumbnail_url, ' +
	'saved, completed, year, month, clip_id';
const FILTERS = 'date:FORMAT, slug, upper, lower, truncate:N, yaml, wikilink, list, quote, tag';

const OVERRIDE = 'override:'; // control keys for per-notebook folders route into folderOverrides

interface Notebook {
	id: number;
	name: string;
	destinations: string[];
}

function str(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return '';
}

/**
 * Declarative (Obsidian 1.13+): the framework renders `getSettingDefinitions()`
 * and indexes it for settings search, so there is no display() here. Rows
 * that need more than a bound control — the account, the buttons — are
 * `render` and `action` definitions.
 */
export class ClippingsSettingTab extends PluginSettingTab {
	plugin: ClippingsPlugin;
	private notebooks: Notebook[] | null = null;
	private notebooksFor: string | null = null; // the sign-in the list was fetched under

	constructor(app: App, plugin: ClippingsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Re-render — the sign-in callback lands while the tab is open. */
	refresh(): void {
		this.update();
	}

	// ---- value routing: a few keys are not plain settings properties ----

	getControlValue(key: string): unknown {
		const s = this.plugin.settings;
		if (key === 'noteTemplate') return s.noteTemplate || DEFAULT_NOTE_TEMPLATE;
		if (key === 'syncEveryMinutes') return String(s.syncEveryMinutes);
		if (key.startsWith(OVERRIDE)) return s.folderOverrides[Number(key.slice(OVERRIDE.length))] ?? '';
		return super.getControlValue(key);
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const s = this.plugin.settings;
		if (key === 'noteTemplate') {
			const v = str(value);
			s.noteTemplate = v.trim() === DEFAULT_NOTE_TEMPLATE.trim() ? '' : v;
		} else if (key === 'syncEveryMinutes') {
			s.syncEveryMinutes = parseInt(String(value), 10) || 0;
			this.plugin.schedule();
		} else if (key === 'server') {
			const next = (str(value).trim() || DEFAULT_SERVER).replace(/\/+$/, '');
			if (next !== s.server) {
				s.server = next;
				this.plugin.auth.save(null); // tokens belong to the old server
				this.notebooks = null;
			}
		} else if (key === 'baseFolder') {
			s.baseFolder = str(value).trim() || DEFAULT_SETTINGS.baseFolder;
		} else if (key === 'filenameTemplate') {
			s.filenameTemplate = str(value).trim() || DEFAULT_FILENAME_TEMPLATE;
		} else if (key.startsWith(OVERRIDE)) {
			const id = Number(key.slice(OVERRIDE.length));
			const clean = str(value).trim();
			if (clean) s.folderOverrides[id] = clean;
			else delete s.folderOverrides[id];
		} else {
			await super.setControlValue(key, value);
			return;
		}
		await this.plugin.saveSettings();
	}

	private loading = false;

	/** Fetch the notebook list once per sign-in, then re-render with it. */
	private loadNotebooks(): void {
		const tokens = this.plugin.auth.load();
		if (!tokens) {
			this.notebooks = null;
			return;
		}
		if (this.loading || (this.notebooksFor === tokens.access && this.notebooks)) return;
		this.loading = true;
		void this.plugin.api
			.notebooks()
			.then((list) => {
				this.notebooks = list;
				this.notebooksFor = tokens.access;
			})
			.catch(() => {
				this.notebooks = [];
			})
			.finally(() => {
				this.loading = false;
				this.refresh();
			});
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		// Called on every render: the moment to start fetching notebooks if
		// they are not in hand yet (guarded, so it never loops).
		this.loadNotebooks();
		const connected = () => this.plugin.isConnected();
		const templateHelp = createFragment((f) => {
			f.appendText('Variables: ');
			f.createEl('code', { text: VARIABLES });
			f.createEl('br');
			f.appendText('Filters: ');
			f.createEl('code', { text: FILTERS });
			f.createEl('br');
			f.appendText('Blocks: ');
			f.createEl('code', { text: '{{#if note}} … {{else}} … {{/if}}' });
			f.appendText('. Keep clippings_id in the frontmatter — it is how the plugin recognises its own notes.');
		});

		// Built against the configured server so the link follows a dev server
		// rather than always pointing at production.
		const accountHelp = createFragment((f) => {
			f.appendText('Sign in to Clippings to sync clips into this vault. ');
			f.createEl('a', {
				text: 'What Clippings stores for this vault',
				href: `${this.plugin.settings.server.replace(/\/+$/, '')}/privacy#obsidian`,
			});
			f.appendText('.');
		});

		return [
			{
				name: 'Account',
				desc: accountHelp,
				aliases: ['connect', 'disconnect', 'sign in', 'log in'],
				render: (setting: Setting) => this.renderAccount(setting),
			},
			{
				type: 'group',
				heading: 'Where clips land',
				items: [
					{
						name: 'Base folder',
						desc: 'Every synced note lives under this folder.',
						control: { type: 'text', key: 'baseFolder', placeholder: DEFAULT_SETTINGS.baseFolder },
					},
					{
						name: 'Folder template',
						desc: 'Sub-folder under the base folder. Leave empty for none. Variables: notebook, platform, platform_label, creator, year, month.',
						control: {
							type: 'text',
							key: 'folderTemplate',
							placeholder: DEFAULT_FOLDER_TEMPLATE,
							validate: (v) => templateError(v) || undefined,
						},
					},
					{
						name: 'Filename template',
						desc: 'Without the .md. Variables and filters as for the note template.',
						control: {
							type: 'text',
							key: 'filenameTemplate',
							placeholder: DEFAULT_FILENAME_TEMPLATE,
							validate: (v) => templateError(v) || undefined,
						},
					},
					...this.overrideItems(),
				],
			},
			// The editor is its own group so styles.css can stack its row
			// vertically by group class: the declarative API has no per-item
			// class, and matching the row by its textarea would need :has().
			{
				type: 'group',
				heading: 'The note',
				cls: 'clippings-template-editor',
				items: [
					{ name: 'Template help', desc: templateHelp, searchable: false },
					{
						name: 'Note template',
						desc: 'What each clip becomes. Empty means the built-in default, shown here for editing.',
						aliases: ['frontmatter', 'properties'],
						control: {
							type: 'textarea',
							key: 'noteTemplate',
							rows: 18,
							validate: (v) => templateError(v.trim() ? v : DEFAULT_NOTE_TEMPLATE) || undefined,
						},
					},
				],
			},
			{
				type: 'group',
				items: [
					{
						name: 'Reset the note template',
						desc: 'Back to the built-in default.',
						action: () => {
							this.plugin.settings.noteTemplate = '';
							void this.plugin.saveSettings().then(() => this.refresh());
						},
					},
					{
						name: 'If a note already exists',
						desc: 'What happens when a clip arrives and its note is already in the vault, and what "Re-render notes" may touch. "Unedited" means the note is exactly what the plugin last wrote.',
						control: {
							type: 'dropdown',
							key: 'existingNote',
							options: {
								skip: 'Leave it alone',
								'overwrite-if-unedited': 'Overwrite if unedited',
								overwrite: 'Overwrite',
							},
						},
					},
					{
						name: 'Re-render notes',
						desc: 'Rewrite every note this vault has from the current template, respecting the setting above.',
						disabled: () => !connected(),
						action: () => void this.plugin.rerender(),
					},
				],
			},
			{
				type: 'group',
				heading: 'Sync',
				items: [
					{ name: 'Sync when Obsidian opens', control: { type: 'toggle', key: 'syncOnLaunch' } },
					{
						name: 'Sync every',
						control: {
							type: 'dropdown',
							key: 'syncEveryMinutes',
							options: { '0': 'Only when I ask', '5': '5 minutes', '15': '15 minutes', '30': '30 minutes', '60': 'Hour' },
						},
					},
					{
						name: 'Include clips saved before this vault was connected',
						desc: 'Off means only clips saved from now on arrive here.',
						aliases: ['history'],
						control: { type: 'toggle', key: 'syncHistory' },
					},
					{
						name: 'Sync now',
						desc: 'Also available as the command "Clippings: Sync now".',
						disabled: () => !connected(),
						action: () => void this.plugin.syncNow(),
					},
				],
			},
			{
				type: 'group',
				heading: 'Advanced',
				items: [
					{
						name: 'Server',
						desc: 'Leave as is unless you run your own server for development. Changing it signs this vault out.',
						control: { type: 'text', key: 'server', placeholder: DEFAULT_SERVER },
					},
					{
						name: 'Vault key',
						desc: 'How the server tells this vault from your others. Minted once; there is no reason to change it.',
						control: { type: 'text', key: 'vaultKey', disabled: true },
					},
				],
			},
		];
	}

	private overrideItems(): SettingGroupItem[] {
		if (!this.plugin.isConnected()) return [];
		if (this.notebooks === null) {
			return [{ name: 'Per-notebook folders', desc: 'Loading your notebooks…', searchable: false }];
		}
		if (!this.notebooks.length) {
			return [{ name: 'Per-notebook folders', desc: 'No notebooks yet.', searchable: false }];
		}
		return [
			{
				name: 'Per-notebook folders',
				desc: 'Send a notebook somewhere other than the folder template says. Relative to the base folder; empty uses the template.',
			},
			...this.notebooks.map((nb): SettingGroupItem => ({
				name: nb.name,
				desc: nb.destinations.includes('obsidian') ? '' : 'Not publishing to Obsidian — change that on the notebook’s edit page.',
				aliases: ['notebook folder'],
				control: { type: 'text', key: `${OVERRIDE}${nb.id}`, placeholder: 'Folder template' },
			})),
		];
	}

	private renderAccount(setting: Setting): void {
		const tokens = this.plugin.auth.load();
		if (tokens) {
			setting
				.setDesc(
					`Connected as ${tokens.email ?? 'your account'}` +
						(tokens.planLabel ? ` (${tokens.planLabel})` : '') +
						'. Turn Obsidian on in your Clippings settings to publish here.',
				)
				.addButton((b) =>
					b.setButtonText('Disconnect').onClick(async () => {
						b.setDisabled(true);
						await this.plugin.disconnect();
					}),
				);
		} else {
			setting
				.setDesc('Not connected. Connect opens your browser to sign in to Clippings, or create a free account, and sends you back here.')
				.addButton((b) =>
					b
						.setButtonText('Connect')
						.setCta()
						.onClick(async () => {
							await this.plugin.connect();
						}),
				);
		}
	}
}
