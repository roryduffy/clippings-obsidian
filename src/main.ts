import { Notice, Plugin } from 'obsidian';
import { ApiClient, SignedOut } from './api';
import { AuthError, AuthStore, PROTOCOL_ACTION } from './auth';
import { ClippingsSettingTab, ClippingsSettings, DEFAULT_SETTINGS } from './settings';

export default class ClippingsPlugin extends Plugin {
	settings!: ClippingsSettings;
	auth!: AuthStore;
	api!: ApiClient;
	settingTab!: ClippingsSettingTab;

	async onload() {
		await this.loadSettings();
		this.auth = new AuthStore(this.app);
		this.api = new ApiClient(this.auth);

		// The browser comes back here after sign-in: obsidian://clippings-auth?code=…&state=…
		this.registerObsidianProtocolHandler(PROTOCOL_ACTION, (params) => {
			void this.finishConnect(params);
		});

		this.addCommand({
			id: 'sync-now',
			name: 'Sync now',
			callback: () => {
				void this.syncNow();
			},
		});

		this.settingTab = new ClippingsSettingTab(this.app, this);
		this.addSettingTab(this.settingTab);
	}

	onunload() {}

	isConnected(): boolean {
		return this.auth.load() !== null;
	}

	async connect(): Promise<void> {
		try {
			await this.auth.begin(this.settings.server);
			new Notice('Finish signing in to Clippings in your browser.');
		} catch (e) {
			new Notice(`Could not start the sign-in: ${(e as Error).message}`);
		}
	}

	private async finishConnect(params: Record<string, string>): Promise<void> {
		try {
			const tokens = await this.auth.complete(params);
			// Pair this vault with the new sign-in, then learn who signed in
			// so the settings tab can say so.
			await this.api.registerVault(this.settings.vaultKey, this.app.vault.getName());
			const me = await this.api.me();
			tokens.email = me.email;
			tokens.planLabel = me.plan_label;
			this.auth.save(tokens);
			new Notice(
				`Connected ${this.app.vault.getName()} to Clippings as ${me.email}. ` +
					'Turn on Obsidian in your Clippings settings to start publishing here.',
				10_000,
			);
		} catch (e) {
			const msg = e instanceof AuthError || e instanceof SignedOut ? e.message : `Connecting failed: ${(e as Error).message}`;
			new Notice(msg, 10_000);
		}
		this.settingTab.refresh();
	}

	async disconnect(): Promise<void> {
		try {
			// Server first so the vault card on the web updates; the local
			// tokens are cleared either way by revoke().
			await this.api.disconnectVault(this.settings.vaultKey).catch(() => undefined);
			await this.auth.revoke();
			new Notice('Disconnected from Clippings. Notes already in this vault are untouched.');
		} catch (e) {
			new Notice(`Could not disconnect: ${(e as Error).message}`);
		}
		this.settingTab.refresh();
	}

	async syncNow(): Promise<void> {
		if (!this.isConnected()) {
			new Notice('Connect Clippings in the plugin settings first.');
			return;
		}
		// The sync engine arrives with Day 4 (docs/OBSIDIAN.md §7–8 in the backend repo).
		new Notice('Clippings: sync is not built yet — the connection works, the notes come next.');
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
