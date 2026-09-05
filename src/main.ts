import { Notice, Plugin } from 'obsidian';
import { ClippingsSettingTab, ClippingsSettings, DEFAULT_SETTINGS } from './settings';

export default class ClippingsPlugin extends Plugin {
	settings!: ClippingsSettings;

	async onload() {
		await this.loadSettings();

		this.addCommand({
			id: 'sync-now',
			name: 'Sync now',
			callback: () => {
				void this.syncNow();
			},
		});

		this.addSettingTab(new ClippingsSettingTab(this.app, this));
	}

	onunload() {}

	async syncNow(): Promise<void> {
		// Day 0: the command exists and the plugin loads. The sync engine
		// arrives with Day 4 (docs/OBSIDIAN.md §7–8 in the backend repo).
		new Notice('Clippings: nothing to sync yet — connect an account first.');
	}

	async loadSettings() {
		const stored = ((await this.loadData()) ?? {}) as Partial<ClippingsSettings>;
		this.settings = { ...DEFAULT_SETTINGS, ...stored };
		if (!this.settings.vaultKey) {
			// Minted once and kept in data.json so it follows the vault across
			// devices and survives re-auth; the server ledgers per vault key.
			this.settings.vaultKey = crypto.randomUUID();
			await this.saveSettings();
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
