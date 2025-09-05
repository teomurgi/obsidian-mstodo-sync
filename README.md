# Obsidian Microsoft To Do Sync Plugin

A plugin that provides bidirectional synchronization between Obsidian tasks and Microsoft To Do.

**⚠️ Personal Accounts Only**: This plugin is designed for personal Microsoft accounts (outlook.com, hotmail.com, live.com, xbox.com). It does not support work/school accounts.

## Features

- **Bidirectional Sync**: Changes in either Obsidian or Microsoft To Do are reflected in the other
- **Task Parsing**: Supports standard Obsidian task syntax (`- [ ]` and `- [x]`)
- **Metadata Support**: Syncs due dates (📅), priorities (🔺🔻), and tags (#tag)
- **Conflict Resolution**: Handles simultaneous edits by comparing modification timestamps
- **Auto Sync**: Optional automatic synchronization at configurable intervals
- **Secure Authentication**: Uses Microsoft's OAuth 2.0 with MSAL

## Setup

### 1. Microsoft App Registration

Before using this plugin, you need to register an application in Azure Active Directory:

1. Go to [Azure Portal](https://portal.azure.com) → Azure Active Directory → App registrations
2. Click "New registration"
3. Enter a name (e.g., "Obsidian To Do Sync")
4. **Important**: Select "Personal Microsoft accounts only" (not organizational accounts)
5. Add redirect URI: `https://login.microsoftonline.com/common/oauth2/nativeclient` (Platform: Single-page application)
6. After creation, note the **Application (client) ID**
7. Go to "API permissions" → Add "Microsoft Graph" → Delegated permissions:
   - `Tasks.ReadWrite`
   - `User.Read`
8. No admin consent needed for personal accounts

### 2. Plugin Installation

1. Download or clone this repository
2. Copy the folder to your Obsidian plugins directory: `{VaultPath}/.obsidian/plugins/obsidian-mstodo-sync/`
3. Run `npm install` to install dependencies
4. Run `npm run build` to build the plugin
5. Enable the plugin in Obsidian Settings → Community Plugins

### 3. Configuration

1. Open Obsidian Settings → Microsoft To Do Sync
2. Enter your **Client ID** from the Azure app registration
3. **Account Type** is fixed to "consumers" for personal accounts only
4. Configure sync preferences:
   - **Auto Sync**: Enable/disable automatic synchronization
   - **Sync Interval**: How often to sync (1-60 minutes)
   - **Default List**: Which Microsoft To Do list to use for new tasks
5. Click **Sign In** to authenticate with your personal Microsoft account

## Usage

### Task Syntax

The plugin recognizes standard Obsidian task format with additional metadata:

```markdown
- [ ] Basic task
- [x] Completed task
- [ ] Task with due date 📅 2024-01-15
- [ ] High priority task 🔺
- [ ] Low priority task 🔻
- [ ] Task with tags #work #urgent
- [ ] Task synced with MS To Do [ms-todo:ABC123]
```

### Sync Operations

- **Manual Sync**: Click the sync ribbon icon or use Command Palette → "Sync with Microsoft To Do"
- **Auto Sync**: Enabled by default, syncs every 5 minutes
- **Authentication**: Use Command Palette → "Authenticate with Microsoft To Do"

### Metadata Mapping

| Obsidian | Microsoft To Do | Notes |
|----------|-----------------|-------|
| `- [ ]` | `notStarted` | Unchecked task |
| `- [x]` | `completed` | Checked task |
| `📅 YYYY-MM-DD` | `dueDateTime` | Due date |
| `🔺` or `⏫` | `high` importance | High priority |
| `🔻` | `low` importance | Low priority |
| `#tag` | Task body | Tags stored in task notes |

## Development

### Building

```bash
npm install
npm run dev    # Development build with watch
npm run build  # Production build
```

### File Structure

```
src/
├── main.ts      # Main plugin class and settings UI
├── auth.ts      # Microsoft authentication using MSAL
├── parser.ts    # Task parsing and format conversion
└── sync.ts      # Bidirectional synchronization logic
```

## Troubleshooting

### Common Issues

1. **Authentication Failed**
   - Verify Client ID is correct
   - Ensure Azure app is configured for "Personal Microsoft accounts only"
   - Check redirect URI is configured as `https://login.microsoftonline.com/common/oauth2/nativeclient`
   - Make sure you're using a personal Microsoft account (not work/school)

2. **Tasks Not Syncing**
   - Check if authentication is still valid (may need to re-authenticate)
   - Verify task format matches supported syntax
   - Look for error messages in Developer Console (Ctrl+Shift+I)

3. **Duplicate Tasks**
   - This can happen if the MS To Do ID link is lost
   - The plugin includes conflict resolution, but manual cleanup may be needed

### Debug Mode

Enable Developer Console in Obsidian (Ctrl+Shift+I) to see detailed sync logs.

## Privacy & Security

- Authentication tokens are stored securely using MSAL browser storage
- No task data is sent to third parties (only Microsoft Graph API)
- Plugin only requests minimum necessary permissions
- All communication is encrypted (HTTPS)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Support

For issues and feature requests, please use the GitHub issue tracker.