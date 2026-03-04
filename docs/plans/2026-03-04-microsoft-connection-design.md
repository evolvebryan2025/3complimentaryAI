# Microsoft Connection Design

**Date:** 2026-03-04
**Approach:** Direct Mirror (mirror Google OAuth pattern 1:1)
**Constraint:** One provider at a time (Google OR Microsoft, not both)

## Azure App Registration

- Register at portal.azure.com > Microsoft Entra ID > App registrations
- Redirect URI: `{URL}/api/auth-microsoft-callback`
- Account type: "Accounts in any organizational directory and personal Microsoft accounts"
- Create client secret
- API permissions (Microsoft Graph, delegated): `User.Read`, `Calendars.Read`, `Mail.Read`, `Mail.Send`, `Files.Read`, `Tasks.Read`

## Environment Variables

```
MICROSOFT_CLIENT_ID=<from Azure portal>
MICROSOFT_CLIENT_SECRET=<from Azure portal>
```

## Scope Mapping

| Google Scope | Microsoft Graph Scope | Purpose |
|---|---|---|
| `userinfo.email` + `userinfo.profile` | `User.Read` | Avatar, email, name |
| `calendar.readonly` | `Calendars.Read` | Read calendar events |
| `gmail.readonly` | `Mail.Read` | Read emails for context |
| `gmail.send` | `Mail.Send` | Send brief to inbox |
| `drive.readonly` | `Files.Read` | Read OneDrive files |
| `tasks.readonly` | `Tasks.Read` | Read To Do tasks |

## Database Changes

Add columns to `users` table:

- `microsoft_access_token` (text, nullable)
- `microsoft_refresh_token` (text, nullable)
- `microsoft_token_expiry` (timestamp, nullable)
- `connected_provider` (text, nullable) — `'google'` | `'microsoft'` | `null`

One-at-a-time enforcement: connecting one provider clears the other's token fields.

## New Netlify Functions

### `auth-microsoft.js`
- Verifies existing session (JWT cookie)
- Builds Microsoft OAuth URL: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize`
- Signs state JWT with userId (CSRF protection)
- Redirects to Microsoft consent screen

### `auth-microsoft-callback.js`
- Verifies state JWT
- Exchanges code for tokens at `https://login.microsoftonline.com/common/oauth2/v2.0/token`
- Fetches profile from `https://graph.microsoft.com/v1.0/me`
- Stores `microsoft_*` tokens in Supabase
- Clears `google_*` fields (one-at-a-time)
- Sets `connected_provider = 'microsoft'`
- Redirects to `/?microsoft=connected`

### `microsoft-disconnect.js`
- Clears `microsoft_*` fields
- Sets `connected_provider = null`
- Note: Microsoft has no token revocation endpoint — tokens expire naturally

## Changes to Existing Files

### `auth-callback.js` (Google callback)
- Clear `microsoft_*` fields when Google connects
- Set `connected_provider = 'google'`

### `google-disconnect.js`
- Set `connected_provider = null`

### `user-disconnect.js` (delete account)
- Clear Microsoft tokens alongside Google tokens

### `generate-brief.js`
- Check `connected_provider` to call Microsoft Graph or Google APIs
- Microsoft Graph endpoints:
  - Calendar: `GET /me/calendarview?startDateTime=...&endDateTime=...`
  - Mail: `GET /me/messages?$top=20&$orderby=receivedDateTime desc`
  - Files: `GET /me/drive/root/children`
  - Tasks: `GET /me/todo/lists` + `GET /me/todo/lists/{id}/tasks`
- Token refresh via `POST https://login.microsoftonline.com/common/oauth2/v2.0/token` with `grant_type=refresh_token`

### `auth-session.js`
- Return `connected_provider` field in session response

### `index.html`
- Add "Connect Microsoft Account" button in Profile & Settings
- Show connected provider with disconnect option
- "Switch to Microsoft/Google" when one is already connected

### `app.js`
- `handleConnectMicrosoft()` — redirect to `/api/auth-microsoft`
- `handleDisconnectMicrosoft()` — POST to `/api/microsoft-disconnect`
- Update `checkSession()` for `?microsoft=connected` toast
- Update `updateUserUI()` to use `connected_provider` for feature gating
- Update feature gate overlays to check `connected_provider` instead of just Google

## Dependencies

No new npm packages. Microsoft Graph is a standard REST API — use Node.js built-in `fetch`.

## netlify.toml

Add redirects for new endpoints:
- `/api/auth-microsoft` -> `/.netlify/functions/auth-microsoft`
- `/api/auth-microsoft-callback` -> `/.netlify/functions/auth-microsoft-callback`
- `/api/microsoft-disconnect` -> `/.netlify/functions/microsoft-disconnect`
