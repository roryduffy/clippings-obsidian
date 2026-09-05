import { App, PluginSettingTab, Setting } from 'obsidian';
import type ClippingsPlugin from './main';

export const DEFAULT_SERVER = 'https://clippingsapp.xyz';

export type ExistingNotePolicy = 'skip' | 'overwrite-if-unedited' | 'append';

export interface ClippingsSettings {
	/** The Clippings server. Only changed for local development. */
	server: string;
	/** Minted once per vault and never changed: the server keys its per-vault ledger on it. */
	vaultKey: string;
	baseFolder: string;
	folderTemplate: string;
	folderOverrides: Record<number, string>; // notebook_id → folder
	filenameTemplate: string;
	noteTemplate: string; // '' means the built-in default
	existingNote: ExistingNotePolicy;
	syncHistory: boolean;
	syncOnLaunch: boolean;
	syncEveryMinutes: number; // 0 = off
	embedThumbnails: boolean;
	/** clip id → vault path, so a clip is never written twice. */
	written: Record<number, string>;
}

export const DEFAULT_SETTINGS: ClippingsSettings = {
	server: DEFAULT_SERVER,
	vaultKey: '',
	baseFolder: 'Clippings',
	folderTemplate: '{{notebook}}',
	folderOverrides: {},
	filenameTemplate: '{{saved|date:YYYY-MM-DD}} {{title|truncate:60}}',
	noteTemplate: '',
	existingNote: 'skip',
	syncHistory: true,
	syncOnLaunch: true,
	syncEveryMinutes: 15,
	embedThumbnails: false,
	written: {},
};

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

		new Setting(containerEl).setName('Where clips land').setHeading();

		new Setting(containerEl)
			.setName('Base folder')
			.setDesc('Every synced note lives under this folder.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.baseFolder)
					.setValue(this.plugin.settings.baseFolder)
					.onChange(async (v) => {
						this.plugin.settings.baseFolder = v.trim() || DEFAULT_SETTINGS.baseFolder;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Folder template')
			.setDesc('Sub-folder under the base folder. Variables: {{notebook}}, {{platform}}, {{creator}}, {{year}}, {{month}}.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.folderTemplate)
					.setValue(this.plugin.settings.folderTemplate)
					.onChange(async (v) => {
						this.plugin.settings.folderTemplate = v.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Filename template')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SETTINGS.filenameTemplate)
					.setValue(this.plugin.settings.filenameTemplate)
					.onChange(async (v) => {
						this.plugin.settings.filenameTemplate = v.trim() || DEFAULT_SETTINGS.filenameTemplate;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName('Advanced').setHeading();

		new Setting(containerEl)
			.setName('Server')
			.setDesc('Leave as is unless you run your own server for development.')
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_SERVER)
					.setValue(this.plugin.settings.server)
					.onChange(async (v) => {
						this.plugin.settings.server = (v.trim() || DEFAULT_SERVER).replace(/\/+$/, '');
						await this.plugin.saveSettings();
					}),
			);
	}
}
