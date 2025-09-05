# 🚀 Easy Setup Guide for Microsoft To Do Sync

## Why Do I Need to Register an App?

Microsoft requires every application that accesses your personal data (like tasks) to be registered for security. This is similar to how you need to approve apps when they ask for permissions on your phone.

**Good news**: It's completely free and takes about 5 minutes!

## 📋 Step-by-Step Setup (5 minutes)

### Step 1: Create Free Azure Account
1. Go to [azure.microsoft.com](https://azure.microsoft.com/free)
2. Click "Start free" 
3. Sign in with your Microsoft account (same one you use for To Do)
4. **No credit card required** for app registration!

### Step 2: Register Your App (2 minutes)
1. Go to [Azure Portal](https://portal.azure.com)
2. Search for "App registrations" and click it
3. Click "New registration"
4. Fill out the form:
   - **Name**: "My Obsidian To Do Sync" (or any name you like)
   - **Account types**: Select "Personal Microsoft accounts only"
   - **Redirect URI**: 
     - Platform: "Single-page application (SPA)"
     - URL: `https://login.microsoftonline.com/common/oauth2/nativeclient`
5. Click "Register"

### Step 3: Get Your Client ID
1. After registration, you'll see an "Overview" page
2. Copy the "Application (client) ID" - it looks like: `12345678-1234-1234-1234-123456789abc`
3. Paste this into the Obsidian plugin settings

### Step 4: Set Permissions
1. Click "API permissions" in the left sidebar
2. Click "Add a permission"
3. Click "Microsoft Graph"
4. Click "Delegated permissions"
5. Search for and select:
   - `Tasks.ReadWrite` (to sync your tasks)
   - `User.Read` (to identify you)
6. Click "Add permissions"

### Step 5: Done! 🎉
- Go back to Obsidian
- Enter your Client ID in the plugin settings
- Click "Sign In"
- Your tasks will start syncing!

## 🔧 Alternative: One-Click Setup Script

**For Advanced Users**: We could create a PowerShell/bash script that automates the Azure app registration using Azure CLI, but this still requires:
- Installing Azure CLI
- Logging into Azure
- Running the script

The manual setup is actually simpler for most users.

## 🤝 Community Options

**Option 1: Ask the Community**
- Check r/ObsidianMD on Reddit
- Ask on Obsidian Discord
- Someone might share their client ID (use at your own risk)

**Option 2: Use Alternative Plugins**
- **Tasks Plugin**: Obsidian-only, very powerful task management
- **Todoist Plugin**: Simpler auth process
- **Manual Export/Import**: Use Microsoft To Do's export feature

## 🔒 Why This is the Secure Approach

By creating your own app registration:
- **You control access** - only you have the client ID
- **Better security** - no shared credentials
- **Rate limits** - you get full API quota
- **Privacy** - direct connection to Microsoft, no middleman
- **Reliability** - won't break if someone else's registration is revoked

## ❓ Troubleshooting

**"I don't want to create an Azure account"**
- Unfortunately, this is Microsoft's requirement for accessing their APIs
- The account is free and doesn't require payment info for app registration

**"This seems complicated"**
- It's a one-time setup that takes 5 minutes
- Once done, the plugin works automatically forever
- Much simpler than setting up other automation tools

**"Can't you just include a client ID in the plugin?"**
- This would violate Microsoft's terms of service
- Would create security and reliability issues
- Could get the plugin banned from the store

Need help? Ask in the GitHub issues or Obsidian community!
