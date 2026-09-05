import { App, PluginSettingTab, Setting } from 'obsidian';
import type ClippingsPlugin from './main';
import {
	DEFAULT_FILENAME_TEMPLATE,
	DEFAULT_FOLDER_TEMPLATE,
	DEFAULT_NOTE_TEMPLATE,
	render,
	variables,
} from './render';
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

export class ClippingsSettingTab extends PluginSettingTab {
	plugin: ClippingsPlugin;

	constructor(app: App, plugin: ClippingsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/** Re-render if the tab is open — the sign-in callback lands while it is. */
	refresh(): void {
		if (this.containerEl.isShown()) this.display();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;
		const save = () => this.plugin.saveSettings();

		// ---- Account ----
		const tokens = this.plugin.auth.load();
		if (tokens) {
			new Setting(containerEl)
				.setName('Account')
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
			new Setting(containerEl)
				.setName('Account')
				.setDesc('Not connected. Connect opens your browser to sign in to Clippings and sends you back here.')
				.addButton((b) =>
					b
						.setButtonText('Connect')
						.setCta()
						.onClick(async () => {
							await this.plugin.connect();
						}),
				);
		}

		// ---- Where clips land ----
		new Setting(containerEl).setName('Where clips land').setHeading();

		new Setting(containerEl)
			.setName('Base folder')
			.setDesc('Every synced note lives under this folder.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.baseFolder)
					.setValue(s.baseFolder)
					.onChange(async (v) => {
						s.baseFolder = v.trim() || DEFAULT_SETTINGS.baseFolder;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName('Folder template')
			.setDesc('Sub-folder under the base folder. Leave empty for none. Variables: notebook, platform, platform_label, creator, year, month.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_FOLDER_TEMPLATE)
					.setValue(s.folderTemplate)
					.onChange(async (v) => {
						s.folderTemplate = v.trim();
						await save();
					}),
			);

		new Setting(containerEl)
			.setName('Filename template')
			.setDesc(`Without the .md. Variables and filters as for the note template.`)
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_FILENAME_TEMPLATE)
					.setValue(s.filenameTemplate)
					.onChange(async (v) => {
						s.filenameTemplate = v.trim() || DEFAULT_FILENAME_TEMPLATE;
						await save();
					}),
			);

		const overridesEl = containerEl.createDiv();
		if (tokens) void this.renderOverrides(overridesEl);

		// ---- The note ----
		new Setting(containerEl).setName('The note').setHeading();
		const help = containerEl.createDiv({ cls: 'clippings-help' });
		help.createSpan({ text: 'Variables: ' });
		help.createEl('code', { text: VARIABLES });
		help.createEl('br');
		help.createSpan({ text: 'Filters: ' });
		help.createEl('code', { text: FILTERS });
		help.createEl('br');
		help.createSpan({ text: 'Blocks: ' });
		help.createEl('code', { text: '{{#if note}} … {{else}} … {{/if}}' });
		help.createSpan({ text: '. Keep clippings_id in the frontmatter — it is how the plugin recognises its own notes.' });

		const errorEl = containerEl.createDiv({ cls: 'clippings-template-error' });
		const showError = (tpl: string) => {
			errorEl.setText(templateError(tpl.trim() ? tpl : DEFAULT_NOTE_TEMPLATE));
		};
		const templateSetting = new Setting(containerEl)
			.setName('Note template')
			.setDesc('Empty means the built-in default, shown here for editing.')
			.setClass('clippings-template')
			.addTextArea((t) => {
				t.setValue(s.noteTemplate || DEFAULT_NOTE_TEMPLATE).onChange(async (v) => {
					s.noteTemplate = v.trim() === DEFAULT_NOTE_TEMPLATE.trim() ? '' : v;
					showError(v);
					await save();
				});
			});
		templateSetting.controlEl.insertAdjacentElement('afterend', errorEl);
		showError(s.noteTemplate);

		new Setting(containerEl)
			.setName('Reset the note template')
			.setDesc('Back to the built-in default.')
			.addButton((b) =>
				b.setButtonText('Reset to default').onClick(async () => {
					s.noteTemplate = '';
					await save();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName('If a note already exists')
			.setDesc(
				'What happens when a clip arrives and its note is already in the vault, and what "Re-render notes" may touch. ' +
					'"Unedited" means the note is exactly what the plugin last wrote.',
			)
			.addDropdown((d) =>
				d
					.addOptions({
						skip: 'Leave it alone',
						'overwrite-if-unedited': 'Overwrite if unedited',
						overwrite: 'Overwrite',
					})
					.setValue(s.existingNote)
					.onChange(async (v) => {
						s.existingNote = v as ExistingNotePolicy;
						await save();
					}),
			);

		new Setting(containerEl)
			.setName('Re-render notes')
			.setDesc('Rewrite every note this vault has from the current template, respecting the setting above.')
			.addButton((b) =>
				b.setButtonText('Re-render notes').onClick(async () => {
					b.setDisabled(true);
					await this.plugin.rerender();
					b.setDisabled(false);
				}),
			);

		// ---- Sync ----
		new Setting(containerEl).setName('Sync').setHeading();

		new Setting(containerEl)
			.setName('Sync when Obsidian opens')
			.addToggle((t) =>
				t.setValue(s.syncOnLaunch).onChange(async (v) => {
					s.syncOnLaunch = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Sync every')
			.addDropdown((d) =>
				d
					.addOptions({ '0': 'Only when I ask', '5': '5 minutes', '15': '15 minutes', '30': '30 minutes', '60': 'Hour' })
					.setValue(String(s.syncEveryMinutes))
					.onChange(async (v) => {
						s.syncEveryMinutes = parseInt(v, 10) || 0;
						await save();
						this.plugin.schedule();
					}),
			);

		new Setting(containerEl)
			.setName('Include clips saved before this vault was connected')
			.setDesc('Off means only clips saved from now on arrive here.')
			.addToggle((t) =>
				t.setValue(s.syncHistory).onChange(async (v) => {
					s.syncHistory = v;
					await save();
				}),
			);

		new Setting(containerEl)
			.setName('Sync now')
			.setDesc(tokens ? 'Also available as the command "Clippings: Sync now".' : 'Connect first.')
			.addButton((b) =>
				b
					.setButtonText('Sync now')
					.setDisabled(!tokens)
					.onClick(async () => {
						b.setDisabled(true);
						await this.plugin.syncNow();
						b.setDisabled(false);
					}),
			);

		// ---- Advanced ----
		new Setting(containerEl).setName('Advanced').setHeading();

		new Setting(containerEl)
			.setName('Server')
			.setDesc('Leave as is unless you run your own server for development. Changing it signs this vault out.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SERVER)
					.setValue(s.server)
					.onChange(async (v) => {
						const next = (v.trim() || DEFAULT_SERVER).replace(/\/+$/, '');
						if (next !== s.server) {
							s.server = next;
							this.plugin.auth.save(null);
							await save();
						}
					}),
			);

		new Setting(containerEl)
			.setName('Vault key')
			.setDesc('How the server tells this vault from your others. Minted once; there is no reason to change it.')
			.addText((t) => t.setValue(s.vaultKey).setDisabled(true));
	}

	private async renderOverrides(el: HTMLElement): Promise<void> {
		const s = this.plugin.settings;
		let notebooks: { id: number; name: string; destinations: string[] }[];
		try {
			notebooks = await this.plugin.api.notebooks();
		} catch {
			new Setting(el).setName('Per-notebook folders').setDesc('Could not load your notebooks right now.');
			return;
		}
		if (!el.isConnected) return; // the tab was closed while we waited
		new Setting(el)
			.setName('Per-notebook folders')
			.setDesc('Send a notebook somewhere other than the folder template says. Relative to the base folder; empty uses the template.');
		for (const nb of notebooks) {
			const publishes = nb.destinations.includes('obsidian');
			new Setting(el)
				.setName(nb.name)
				.setDesc(publishes ? '' : 'Not publishing to Obsidian — change that on the notebook’s edit page.')
				.addText((t) =>
					t
						.setPlaceholder('Folder template')
						.setValue(s.folderOverrides[nb.id] ?? '')
						.onChange(async (v) => {
							const clean = v.trim();
							if (clean) s.folderOverrides[nb.id] = clean;
							else delete s.folderOverrides[nb.id];
							await this.plugin.saveSettings();
						}),
				);
		}
		if (!notebooks.length) {
			new Setting(el).setDesc('No notebooks yet.');
		}
	}
}
