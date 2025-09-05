import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { MSToDoAuth } from './auth';
import { TaskSync } from './sync';
import { TaskParser } from './parser';

interface MSToDoSyncSettings {
	clientId: string;
	tenantId: string;
	syncInterval: number;
	autoSync: boolean;
	defaultList: string;
	lastSyncTime: number;
	accessToken: string;
}

const DEFAULT_SETTINGS: MSToDoSyncSettings = {
	clientId: '', // See setup instructions below for alternatives
	tenantId: 'consumers',
	syncInterval: 300000, // 5 minutes
	autoSync: true,
	defaultList: '',
	lastSyncTime: 0,
	accessToken: ''
};

export default class MSToDoSyncPlugin extends Plugin {
	settings: MSToDoSyncSettings;
	auth: MSToDoAuth;
	taskSync: TaskSync;
	taskParser: TaskParser;
	syncInterval: NodeJS.Timeout | null = null;

	async onload() {
		await this.loadSettings();

		this.auth = new MSToDoAuth(this.settings.clientId, this.settings.tenantId);
		
		// Load saved access token if available
		if (this.settings.accessToken) {
			this.auth.setManualToken(this.settings.accessToken);
		}
		
		this.taskSync = new TaskSync(this.auth, this.app);
		this.taskParser = new TaskParser();

		// Add ribbon icon
		this.addRibbonIcon('sync', 'Sync with Microsoft To Do', async (evt: MouseEvent) => {
			await this.performSync();
		});

		// Add command
		this.addCommand({
			id: 'sync-mstodo',
			name: 'Sync with Microsoft To Do',
			callback: async () => {
				await this.performSync();
			}
		});

		// Add command to authenticate
		this.addCommand({
			id: 'auth-mstodo',
			name: 'Authenticate with Microsoft To Do',
			callback: async () => {
				await this.authenticate();
			}
		});

		// Add settings tab
		this.addSettingTab(new MSToDoSyncSettingTab(this.app, this));

		// Start auto-sync if enabled
		if (this.settings.autoSync) {
			this.startAutoSync();
		}
	}

	onunload() {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async authenticate() {
		if (!this.settings.clientId) {
			new Notice('Please configure your Microsoft App Client ID in settings first');
			return;
		}

		try {
			await this.auth.authenticate();
			new Notice('Successfully authenticated with Microsoft To Do');
		} catch (error) {
			console.error('Authentication failed:', error);
			new Notice(`Authentication failed: ${error.message}`);
		}
	}

	async performSync() {
		if (!this.auth.isAuthenticated()) {
			new Notice('Please authenticate with Microsoft To Do first');
			return;
		}

		try {
			new Notice('Starting sync with Microsoft To Do...');
			await this.taskSync.performBidirectionalSync();
			this.settings.lastSyncTime = Date.now();
			await this.saveSettings();
			new Notice('Sync completed successfully');
		} catch (error) {
			console.error('Sync failed:', error);
			new Notice(`Sync failed: ${error.message}`);
		}
	}

	startAutoSync() {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
		}

		this.syncInterval = setInterval(async () => {
			if (this.auth.isAuthenticated()) {
				await this.performSync();
			}
		}, this.settings.syncInterval);
	}

	stopAutoSync() {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
			this.syncInterval = null;
		}
	}
}

class MSToDoSyncSettingTab extends PluginSettingTab {
	plugin: MSToDoSyncPlugin;

	constructor(app: App, plugin: MSToDoSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Microsoft To Do Sync Settings' });

		new Setting(containerEl)
			.setName('Microsoft App Client ID')
			.setDesc('Your Azure App Registration Client ID (configured for personal Microsoft accounts only)')
			.addText(text => text
				.setPlaceholder('Enter your client ID')
				.setValue(this.plugin.settings.clientId)
				.onChange(async (value) => {
					this.plugin.settings.clientId = value;
					await this.plugin.saveSettings();
					this.plugin.auth.updateClientId(value);
				}));

		new Setting(containerEl)
			.setName('Account Type')
			.setDesc('This plugin is configured for personal Microsoft accounts only (outlook.com, hotmail.com, live.com)')
			.addText(text => text
				.setPlaceholder('consumers (fixed)')
				.setValue('consumers')
				.setDisabled(true));

		new Setting(containerEl)
			.setName('Auto Sync')
			.setDesc('Automatically sync tasks at regular intervals')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSync)
				.onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.startAutoSync();
					} else {
						this.plugin.stopAutoSync();
					}
				}));

		new Setting(containerEl)
			.setName('Sync Interval')
			.setDesc('How often to sync (in minutes)')
			.addSlider(slider => slider
				.setLimits(1, 60, 1)
				.setValue(this.plugin.settings.syncInterval / 60000)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.syncInterval = value * 60000;
					await this.plugin.saveSettings();
					if (this.plugin.settings.autoSync) {
						this.plugin.startAutoSync();
					}
				}));

		new Setting(containerEl)
			.setName('Default To Do List')
			.setDesc('Default Microsoft To Do list for new tasks')
			.addText(text => text
				.setPlaceholder('Tasks')
				.setValue(this.plugin.settings.defaultList)
				.onChange(async (value) => {
					this.plugin.settings.defaultList = value;
					await this.plugin.saveSettings();
				}));

		// Authentication section
		containerEl.createEl('h3', { text: 'Authentication' });

		new Setting(containerEl)
			.setName('Authenticate')
			.setDesc('Sign in to your Microsoft account')
			.addButton(button => button
				.setButtonText('Sign In')
				.setCta()
				.onClick(async () => {
					await this.plugin.authenticate();
				}));

		new Setting(containerEl)
			.setName('Manual Token')
			.setDesc('Paste the complete redirect URL or just the access token - the plugin will automatically extract it')
			.addText(text => text
				.setPlaceholder('Paste complete redirect URL or access token here')
				.setValue(this.plugin.settings.accessToken ? '••••••••••••' : '')
				.onChange(async (value) => {
					if (value.trim() && !value.startsWith('••••')) {
						try {
							this.plugin.auth.setManualToken(value.trim());
							// Save the actual extracted token, not the full URL
							this.plugin.settings.accessToken = this.plugin.auth.getStoredAccessToken();
							await this.plugin.saveSettings();
							new Notice('✅ Access token extracted and saved successfully! You can now sync.');
							// Refresh the settings display to update authentication status
							this.display();
						} catch (error) {
							new Notice(`❌ Invalid token: ${error.message}`);
						}
					}
				}));

		new Setting(containerEl)
			.setName('Manual Auth Instructions')
			.setDesc('Click to show manual authentication steps')
			.addButton(button => button
				.setButtonText('Show Instructions')
				.onClick(() => {
					const instructions = this.plugin.auth.getManualAuthInstructions();
					new Notice(instructions, 10000);
					console.log('Manual Auth Instructions:', instructions);
				}));

		// Add button to clear saved token
		new Setting(containerEl)
			.setName('Clear Saved Token')
			.setDesc('Remove the saved access token from settings')
			.addButton(button => button
				.setButtonText('Clear Token')
				.setWarning()
				.onClick(async () => {
					this.plugin.settings.accessToken = '';
					await this.plugin.saveSettings();
					this.plugin.auth.clearToken();
					new Notice('🗑️ Saved token cleared. You will need to re-authenticate.');
					this.display();
				}));

		// Add setup alternatives 
		const setupEl = containerEl.createEl('div', { cls: 'setting-item' });
		setupEl.createEl('div', { text: 'Setup Options:', cls: 'setting-item-name' });
		const setupDesc = setupEl.createEl('div', { cls: 'setting-item-description' });
		setupDesc.innerHTML = `
			<strong>Option 1 - Free Azure Account (Recommended):</strong><br>
			1. Sign up for free Azure account at <a href="https://azure.microsoft.com/free" target="_blank">azure.microsoft.com/free</a><br>
			2. Create app registration: "Personal Microsoft accounts only"<br>
			3. <strong>Redirect URI:</strong> https://login.microsoftonline.com/common/oauth2/nativeclient<br>
			4. API permissions: Microsoft Graph → Tasks.ReadWrite, User.Read<br>
			5. No credit card required for basic app registration<br><br>
			
			<strong>Option 2 - Community Shared Client ID:</strong><br>
			Search GitHub/Reddit for "Microsoft To Do Obsidian client ID" or ask on Discord<br><br>
			
			<strong>Option 3 - Alternative Tools:</strong><br>
			• Tasks plugin (Obsidian-only, very powerful)<br>
			• Todoist plugin (simpler auth)<br>
			• Manual export/import workflows
		`;
		setupEl.appendChild(setupDesc);

		// Status display
		const statusEl = containerEl.createEl('div', { cls: 'setting-item' });
		statusEl.createEl('div', { cls: 'setting-item-info' });
		const statusDesc = statusEl.createEl('div', { cls: 'setting-item-description' });
		
		if (this.plugin.auth?.isAuthenticated()) {
			statusDesc.setText('✅ Authenticated');
		} else {
			statusDesc.setText('❌ Not authenticated');
		}

		if (this.plugin.settings.lastSyncTime > 0) {
			const lastSync = new Date(this.plugin.settings.lastSyncTime);
			statusDesc.appendChild(document.createElement('br'));
			statusDesc.appendText(`Last sync: ${lastSync.toLocaleString()}`);
		}
	}
}