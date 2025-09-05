import { PublicClientApplication, Configuration, AuthenticationResult, SilentRequest, RedirectRequest } from '@azure/msal-browser';

export class MSToDoAuth {
	private msalInstance: PublicClientApplication;
	private config: Configuration;
	private accessToken: string | null = null;

	constructor(clientId: string, tenantId: string = 'consumers') {
		this.config = {
			auth: {
				clientId: clientId,
				authority: `https://login.microsoftonline.com/${tenantId}`,
				redirectUri: 'https://login.microsoftonline.com/common/oauth2/nativeclient'
			},
			cache: {
				cacheLocation: 'localStorage',
				storeAuthStateInCookie: false
			}
		};

		if (clientId) {
			this.msalInstance = new PublicClientApplication(this.config);
		}
	}

	updateClientId(clientId: string) {
		this.config.auth.clientId = clientId;
		if (clientId) {
			this.msalInstance = new PublicClientApplication(this.config);
		}
	}

	updateTenantId(tenantId: string) {
		this.config.auth.authority = `https://login.microsoftonline.com/${tenantId}`;
		if (this.config.auth.clientId) {
			this.msalInstance = new PublicClientApplication(this.config);
		}
	}

	async authenticate(): Promise<void> {
		if (!this.msalInstance) {
			throw new Error('Client ID not configured');
		}

		await this.msalInstance.initialize();
		
		// Try silent authentication first
		const accounts = this.msalInstance.getAllAccounts();
		if (accounts.length > 0) {
			const silentRequest: SilentRequest = {
				scopes: [
					'https://graph.microsoft.com/Tasks.ReadWrite',
					'https://graph.microsoft.com/User.Read'
				],
				account: accounts[0]
			};

			try {
				const response = await this.msalInstance.acquireTokenSilent(silentRequest);
				this.accessToken = response.accessToken;
				return;
			} catch (error) {
				console.log('Silent authentication failed, need manual authentication');
			}
		}

		// For Obsidian environment, we need to open browser manually
		const authUrl = this.getAuthUrl();
		
		// Open the auth URL in system browser
		if (window.require) {
			const { shell } = window.require('electron');
			await shell.openExternal(authUrl);
		} else {
			window.open(authUrl, '_blank');
		}
		
		throw new Error('Please complete authentication in your browser, then restart Obsidian and try again.');
	}

	private getAuthUrl(): string {
		const params = new URLSearchParams({
			client_id: this.config.auth.clientId,
			response_type: 'token',
			redirect_uri: this.config.auth.redirectUri!,
			scope: 'https://graph.microsoft.com/Tasks.ReadWrite https://graph.microsoft.com/User.Read',
			response_mode: 'fragment'
		});

		return `${this.config.auth.authority}/oauth2/v2.0/authorize?${params.toString()}`;
	}

	// Add method to validate token format
	private validateTokenFormat(token: string): boolean {
		// Microsoft Graph access tokens should be in JWT format (3 parts separated by dots)
		const parts = token.split('.');
		return parts.length === 3;
	}

	async getAccessToken(): Promise<string> {
		if (!this.accessToken) {
			await this.authenticate();
		}

		// Try to refresh token if needed
		if (this.msalInstance) {
			const accounts = this.msalInstance.getAllAccounts();
			if (accounts.length > 0) {
				const silentRequest: SilentRequest = {
					scopes: [
						'https://graph.microsoft.com/Tasks.ReadWrite',
						'https://graph.microsoft.com/User.Read'
					],
					account: accounts[0]
				};

				try {
					const response = await this.msalInstance.acquireTokenSilent(silentRequest);
					this.accessToken = response.accessToken;
				} catch (error) {
					console.warn('Token refresh failed, using existing token');
				}
			}
		}

		if (!this.accessToken) {
			throw new Error('No access token available');
		}

		return this.accessToken;
	}

	isAuthenticated(): boolean {
		// Check if we have a valid access token (either from MSAL or manual input)
		return this.accessToken !== null && this.accessToken.length > 0;
	}

	async signOut(): Promise<void> {
		if (this.msalInstance) {
			const accounts = this.msalInstance.getAllAccounts();
			if (accounts.length > 0) {
				await this.msalInstance.logoutRedirect({
					account: accounts[0]
				});
			}
		}
		this.accessToken = null;
	}

	getCurrentAccount() {
		if (!this.msalInstance) {
			return null;
		}

		const accounts = this.msalInstance.getAllAccounts();
		return accounts.length > 0 ? accounts[0] : null;
	}

	setManualToken(input: string): void {
		const trimmedInput = input.trim();
		let extractedToken: string;
		
		// Check if user pasted the full redirect URL
		if (trimmedInput.startsWith('https://login.microsoftonline.com')) {
			console.log('Detected full redirect URL, extracting access token...');
			extractedToken = this.extractTokenFromUrl(trimmedInput);
			console.log('Extracted token from URL:', {
				originalLength: trimmedInput.length,
				extractedLength: extractedToken.length,
				extractedPrefix: extractedToken.substring(0, 20)
			});
		} else {
			// Assume it's already just the token
			extractedToken = trimmedInput;
		}
		
		// URL decode the token in case it contains encoded characters
		let decodedToken: string;
		try {
			decodedToken = decodeURIComponent(extractedToken);
		} catch (error) {
			// If decoding fails, use the token as-is
			decodedToken = extractedToken;
		}
		
		// Validate token format and length
		if (decodedToken.length > 50) {
			this.accessToken = decodedToken;
			console.log('Manual token set successfully');
			console.log('Token format debug:', {
				length: decodedToken.length,
				parts: decodedToken.split('.').length,
				prefix: decodedToken.substring(0, 20),
				hasDots: decodedToken.includes('.')
			});
		} else {
			console.error('Token too short');
			throw new Error('Invalid token format. Please ensure you copied the complete access_token value.');
		}
	}
	
	private extractTokenFromUrl(url: string): string {
		// Parse the URL fragment (part after #)
		const hashIndex = url.indexOf('#');
		if (hashIndex === -1) {
			throw new Error('No URL fragment found. Please ensure you copied the complete redirect URL.');
		}
		
		const fragment = url.substring(hashIndex + 1);
		const params = new URLSearchParams(fragment);
		
		const accessToken = params.get('access_token');
		if (!accessToken) {
			throw new Error('No access_token found in URL. Please ensure you copied the correct redirect URL.');
		}
		
		return accessToken;
	}

	clearToken(): void {
		this.accessToken = null;
		console.log('Access token cleared');
	}

	getStoredAccessToken(): string | null {
		return this.accessToken;
	}

	getManualAuthInstructions(): string {
		const authUrl = this.getAuthUrl();
		return `
Manual Authentication Steps (Personal Microsoft Accounts Only):
1. Open this URL in your browser: ${authUrl}
2. Sign in with your personal Microsoft account (outlook.com, hotmail.com, live.com)
3. After successful login, you'll see a blank page or error page - this is normal
4. Copy the ENTIRE URL from your browser address bar
5. Paste the complete URL in the "Manual Token" field below

The plugin will automatically extract the access token from the URL for you!

Alternative: You can also manually extract just the token part after "access_token=" if you prefer.

Note: This plugin only works with personal Microsoft accounts, not work/school accounts.
		`.trim();
	}
}