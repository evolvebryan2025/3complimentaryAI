# Microsoft Connection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Microsoft OAuth connection mirroring the existing Google connection, so users can connect either Google or Microsoft (one at a time) for meeting briefs, priorities, and inbox summary.

**Architecture:** Direct Mirror — new Microsoft-specific Netlify Functions that follow the exact same patterns as Google. A `connected_provider` field tracks which provider is active. The three feature functions (generate-brief, generate-priorities, inbox-summary) branch on provider to call either Google APIs or Microsoft Graph.

**Tech Stack:** Netlify Functions (Node.js), Microsoft Graph REST API (no SDK — use built-in `fetch`), Supabase, JWT

---

### Task 1: Azure App Registration (Manual — User)

**This is a manual step the user performs in the Azure portal.**

**Step 1: Create the app registration**

1. Go to https://portal.azure.com
2. Navigate to Microsoft Entra ID → App registrations → New registration
3. Name: "Meeting Preparation Automation"
4. Supported account types: "Accounts in any organizational directory and personal Microsoft accounts"
5. Redirect URI: Select "Web" and enter `http://localhost:8888/.netlify/functions/auth-microsoft-callback`
6. Click Register

**Step 2: Create client secret**

1. In the app registration, go to Certificates & secrets → New client secret
2. Description: "meetprep-secret", Expiry: 24 months
3. Copy the secret **Value** (not the ID) immediately — it won't be shown again

**Step 3: Add API permissions**

1. Go to API permissions → Add a permission → Microsoft Graph → Delegated permissions
2. Add these permissions:
   - `User.Read` (should already be there)
   - `Calendars.Read`
   - `Mail.Read`
   - `Mail.Send`
   - `Files.Read`
   - `Tasks.Read`
   - `offline_access` (for refresh tokens)
3. Click "Grant admin consent" if you have admin access (optional for personal accounts)

**Step 4: Copy credentials**

- Application (client) ID → this is `MICROSOFT_CLIENT_ID`
- The client secret value from Step 2 → this is `MICROSOFT_CLIENT_SECRET`

**Step 5: Commit**

No commit needed — this is portal-only.

---

### Task 2: Environment Variables

**Files:**
- Modify: `3complimentaryAI/.env`
- Modify: `3complimentaryAI/.env.example`

**Step 1: Add Microsoft env vars to `.env`**

Add these lines after the Google OAuth section:

```
# Microsoft OAuth (create at https://portal.azure.com → App registrations)
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret
```

**Step 2: Add Microsoft env vars to `.env.example`**

Add after the Google OAuth section:

```
# Microsoft OAuth (create at https://portal.azure.com → App registrations)
MICROSOFT_CLIENT_ID=your-microsoft-client-id
MICROSOFT_CLIENT_SECRET=your-microsoft-client-secret
```

**Step 3: Commit**

```bash
git add 3complimentaryAI/.env.example
git commit -m "feat: add Microsoft OAuth env var placeholders"
```

Note: Do NOT commit `.env` — it contains secrets.

---

### Task 3: Database Migration — Add Microsoft Columns

**Files:**
- Create: `3complimentaryAI/docs/plans/supabase-migration-microsoft.sql` (reference SQL, run in Supabase dashboard)

**Step 1: Write the migration SQL**

Create the file with this content:

```sql
-- Add Microsoft OAuth token columns
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS microsoft_access_token text,
ADD COLUMN IF NOT EXISTS microsoft_refresh_token text,
ADD COLUMN IF NOT EXISTS microsoft_token_expiry timestamptz,
ADD COLUMN IF NOT EXISTS connected_provider text;

-- Backfill connected_provider for existing Google users
UPDATE public.users
SET connected_provider = 'google'
WHERE google_access_token IS NOT NULL;
```

**Step 2: Run migration in Supabase**

Go to Supabase Dashboard → SQL Editor → paste and run the SQL above.

**Step 3: Verify**

In Supabase Dashboard → Table Editor → users, confirm the 4 new columns exist.

**Step 4: Commit**

```bash
git add 3complimentaryAI/docs/plans/supabase-migration-microsoft.sql
git commit -m "feat: add Microsoft token columns migration SQL"
```

---

### Task 4: Create `auth-microsoft.js` — Initiate OAuth Flow

**Files:**
- Create: `3complimentaryAI/netlify/functions/auth-microsoft.js`

**Step 1: Write the function**

Mirror the pattern from `auth-google.js` (lines 1-55) but use Microsoft endpoints:

```javascript
// Microsoft OAuth — "Connect Microsoft" step (requires existing session)
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

exports.handler = async (event) => {
    // 1. Require existing session
    const jwtSecret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
    const cookies = cookie.parse(event.headers.cookie || '');
    const token = cookies.meetprep_session;

    if (!token) {
        return { statusCode: 302, headers: { Location: '/?auth=error&reason=not_logged_in' } };
    }

    let userId;
    try {
        const decoded = jwt.verify(token, jwtSecret);
        userId = decoded.userId;
    } catch {
        return { statusCode: 302, headers: { Location: '/?auth=error&reason=invalid_session' } };
    }

    // 2. Build Microsoft OAuth URL with userId in signed state
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const redirectUri = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/auth-microsoft-callback`;

    const scopes = [
        'User.Read',
        'Calendars.Read',
        'Mail.Read',
        'Mail.Send',
        'Files.Read',
        'Tasks.Read',
        'offline_access',
    ];

    // Sign the state for security
    const state = jwt.sign({ userId }, jwtSecret, { expiresIn: '10m' });

    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: scopes.join(' '),
        response_mode: 'query',
        state,
        prompt: 'consent',
    });

    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`;

    return {
        statusCode: 302,
        headers: { Location: authUrl },
    };
};
```

**Step 2: Verify file created**

```bash
ls 3complimentaryAI/netlify/functions/auth-microsoft.js
```

Expected: file exists.

**Step 3: Commit**

```bash
git add 3complimentaryAI/netlify/functions/auth-microsoft.js
git commit -m "feat: add auth-microsoft.js — initiate Microsoft OAuth flow"
```

---

### Task 5: Create `auth-microsoft-callback.js` — Handle OAuth Callback

**Files:**
- Create: `3complimentaryAI/netlify/functions/auth-microsoft-callback.js`

**Step 1: Write the function**

Mirror the pattern from `auth-callback.js` (lines 1-81) but use Microsoft token + Graph endpoints:

```javascript
// Microsoft OAuth Callback — Exchange code for tokens, UPDATE existing user's Microsoft fields
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

exports.handler = async (event) => {
    const code = event.queryStringParameters?.code;
    const state = event.queryStringParameters?.state;

    if (!code || !state) {
        return {
            statusCode: 302,
            headers: { Location: '/?auth=error&reason=missing_params' },
        };
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const redirectUri = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/auth-microsoft-callback`;
    const jwtSecret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;

    // 1. Verify the signed state to get userId
    let userId;
    try {
        const decoded = jwt.verify(state, jwtSecret);
        userId = decoded.userId;
    } catch {
        return {
            statusCode: 302,
            headers: { Location: '/?auth=error&reason=invalid_state' },
        };
    }

    try {
        // 2. Exchange authorization code for tokens
        const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                scope: 'User.Read Calendars.Read Mail.Read Mail.Send Files.Read Tasks.Read offline_access',
            }),
        });

        if (!tokenRes.ok) {
            const err = await tokenRes.text();
            console.error('Microsoft token exchange failed:', err);
            throw new Error('Token exchange failed');
        }

        const tokens = await tokenRes.json();

        // 3. Get Microsoft profile for avatar
        const profileRes = await fetch('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });

        let avatarUrl = null;
        if (profileRes.ok) {
            // Microsoft Graph /me doesn't return photo URL directly
            // Try to get photo, fall back to null
            try {
                const photoRes = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
                    headers: { Authorization: `Bearer ${tokens.access_token}` },
                });
                if (photoRes.ok) {
                    const photoBuffer = await photoRes.arrayBuffer();
                    const base64 = Buffer.from(photoBuffer).toString('base64');
                    const contentType = photoRes.headers.get('content-type') || 'image/jpeg';
                    avatarUrl = `data:${contentType};base64,${base64}`;
                }
            } catch (e) {
                console.log('Microsoft photo fetch note:', e.message);
            }
        }

        // 4. Update existing user's Microsoft fields + clear Google fields (one-at-a-time)
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const expiryDate = tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
            : null;

        const updateData = {
            microsoft_access_token: tokens.access_token,
            microsoft_refresh_token: tokens.refresh_token || null,
            microsoft_token_expiry: expiryDate,
            connected_provider: 'microsoft',
            // Clear Google fields (one-at-a-time enforcement)
            google_access_token: null,
            google_refresh_token: null,
            google_token_expiry: null,
            updated_at: new Date().toISOString(),
        };

        if (avatarUrl) {
            updateData.avatar_url = avatarUrl;
        }

        const { error } = await supabase
            .from('users')
            .update(updateData)
            .eq('id', userId);

        if (error) throw error;

        // 5. Redirect — user already has a session cookie
        return {
            statusCode: 302,
            headers: { Location: '/?microsoft=connected' },
        };
    } catch (error) {
        console.error('Microsoft auth callback error:', error);
        return {
            statusCode: 302,
            headers: { Location: `/?auth=error&reason=${encodeURIComponent(error.message)}` },
        };
    }
};
```

**Step 2: Commit**

```bash
git add 3complimentaryAI/netlify/functions/auth-microsoft-callback.js
git commit -m "feat: add auth-microsoft-callback.js — exchange code for tokens, store in DB"
```

---

### Task 6: Create `microsoft-disconnect.js` — Disconnect Microsoft

**Files:**
- Create: `3complimentaryAI/netlify/functions/microsoft-disconnect.js`

**Step 1: Write the function**

Mirror `google-disconnect.js` (lines 1-59) but for Microsoft:

```javascript
// Disconnect Microsoft — Clear tokens without deleting account
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const jwtSecret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
    const cookies = cookie.parse(event.headers.cookie || '');
    const token = cookies.meetprep_session;

    if (!token) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Not authenticated' }) };
    }

    try {
        const decoded = jwt.verify(token, jwtSecret);
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

        // Clear Microsoft fields from user record
        // Note: Microsoft doesn't have a token revocation endpoint like Google
        await supabase.from('users').update({
            microsoft_access_token: null,
            microsoft_refresh_token: null,
            microsoft_token_expiry: null,
            connected_provider: null,
            avatar_url: null,
            updated_at: new Date().toISOString(),
        }).eq('id', decoded.userId);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true }),
        };
    } catch (err) {
        console.error('Microsoft disconnect error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to disconnect Microsoft' }) };
    }
};
```

**Step 2: Commit**

```bash
git add 3complimentaryAI/netlify/functions/microsoft-disconnect.js
git commit -m "feat: add microsoft-disconnect.js — clear Microsoft tokens"
```

---

### Task 7: Create `microsoft-graph.js` — Shared Helper for Microsoft Graph API Calls

**Files:**
- Create: `3complimentaryAI/netlify/functions/microsoft-graph.js`

This helper handles token refresh and provides wrapper functions for Microsoft Graph API calls. Used by generate-brief.js, generate-priorities.js, and inbox-summary.js.

**Step 1: Write the helper**

```javascript
// Microsoft Graph API helper — token refresh + API wrappers
const { createClient } = require('@supabase/supabase-js');

/**
 * Refresh Microsoft access token if expired.
 * Returns { access_token, refresh_token, expiry } — updates DB if refreshed.
 */
async function refreshMicrosoftToken(user) {
    const now = Date.now();
    const expiry = user.microsoft_token_expiry ? new Date(user.microsoft_token_expiry).getTime() : 0;

    // If token is still valid (with 5 min buffer), return as-is
    if (expiry > now + 5 * 60 * 1000) {
        return user.microsoft_access_token;
    }

    // Refresh the token
    const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.MICROSOFT_CLIENT_ID,
            client_secret: process.env.MICROSOFT_CLIENT_SECRET,
            refresh_token: user.microsoft_refresh_token,
            grant_type: 'refresh_token',
            scope: 'User.Read Calendars.Read Mail.Read Mail.Send Files.Read Tasks.Read offline_access',
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Microsoft token refresh failed: ${err}`);
    }

    const tokens = await res.json();

    // Update tokens in DB
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
    const updateData = {
        microsoft_access_token: tokens.access_token,
        microsoft_token_expiry: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
    };
    if (tokens.refresh_token) {
        updateData.microsoft_refresh_token = tokens.refresh_token;
    }

    await supabase.from('users').update(updateData).eq('id', user.id);

    return tokens.access_token;
}

/**
 * Call Microsoft Graph API with auto-refreshed token.
 */
async function graphFetch(accessToken, path, options = {}) {
    const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
    const res = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers,
        },
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Graph API error (${res.status}): ${err}`);
    }

    return res.json();
}

/**
 * Get calendar events for a date range.
 * Equivalent to Google Calendar events.list
 */
async function getCalendarEvents(accessToken, startDateTime, endDateTime) {
    const params = new URLSearchParams({
        startDateTime: startDateTime,
        endDateTime: endDateTime,
        $orderby: 'start/dateTime',
        $top: '50',
        $select: 'subject,start,end,attendees,location,bodyPreview,organizer,webLink',
    });

    const data = await graphFetch(accessToken, `/me/calendarview?${params}`);
    return data.value || [];
}

/**
 * Search emails.
 * Equivalent to Gmail messages.list + messages.get
 */
async function searchEmails(accessToken, query, maxResults = 20) {
    const params = new URLSearchParams({
        $top: String(maxResults),
        $orderby: 'receivedDateTime desc',
        $select: 'subject,from,receivedDateTime,bodyPreview,importance,isRead,flag,webLink',
    });

    // Use $search for keyword queries, $filter for date-based queries
    if (query.startsWith('receivedDateTime')) {
        params.set('$filter', query);
    } else {
        params.set('$search', `"${query}"`);
    }

    const data = await graphFetch(accessToken, `/me/messages?${params}`);
    return data.value || [];
}

/**
 * Get important/unread/flagged emails after a date.
 * Equivalent to Gmail query: (is:unread OR is:starred OR is:important) after:DATE
 */
async function getImportantEmails(accessToken, afterDate, maxResults = 30) {
    const params = new URLSearchParams({
        $top: String(maxResults),
        $orderby: 'receivedDateTime desc',
        $filter: `receivedDateTime ge ${afterDate} and (importance eq 'high' or isRead eq false or flag/flagStatus eq 'flagged')`,
        $select: 'id,subject,from,receivedDateTime,bodyPreview,body,importance,isRead,flag,webLink',
    });

    const data = await graphFetch(accessToken, `/me/messages?${params}`);
    return data.value || [];
}

/**
 * Search OneDrive files.
 * Equivalent to Google Drive files.list with fullText search
 */
async function searchFiles(accessToken, query, maxResults = 6) {
    const data = await graphFetch(accessToken, `/me/drive/root/search(q='${encodeURIComponent(query)}')?$top=${maxResults}&$select=name,webUrl,lastModifiedDateTime,file,createdBy`);
    return data.value || [];
}

/**
 * Get To Do tasks.
 * Equivalent to Google Tasks API
 */
async function getTodoTasks(accessToken) {
    const listsData = await graphFetch(accessToken, '/me/todo/lists?$top=10');
    const lists = listsData.value || [];

    const allTasks = [];
    for (const list of lists) {
        try {
            const tasksData = await graphFetch(
                accessToken,
                `/me/todo/lists/${list.id}/tasks?$filter=status ne 'completed'&$top=20&$select=title,importance,dueDateTime,status,body`
            );
            const tasks = (tasksData.value || []).map(t => ({
                ...t,
                listName: list.displayName,
            }));
            allTasks.push(...tasks);
        } catch (e) {
            console.log(`Failed to fetch tasks from list "${list.displayName}":`, e.message);
        }
    }

    return allTasks;
}

/**
 * Send email via Microsoft Graph.
 * Equivalent to Gmail messages.send
 */
async function sendEmail(accessToken, toEmail, subject, htmlBody) {
    await graphFetch(accessToken, '/me/sendMail', {
        method: 'POST',
        body: JSON.stringify({
            message: {
                subject,
                body: {
                    contentType: 'HTML',
                    content: htmlBody,
                },
                toRecipients: [
                    {
                        emailAddress: {
                            address: toEmail,
                        },
                    },
                ],
            },
        }),
    });
}

module.exports = {
    refreshMicrosoftToken,
    graphFetch,
    getCalendarEvents,
    searchEmails,
    getImportantEmails,
    searchFiles,
    getTodoTasks,
    sendEmail,
};
```

**Step 2: Commit**

```bash
git add 3complimentaryAI/netlify/functions/microsoft-graph.js
git commit -m "feat: add microsoft-graph.js — shared helper for Graph API calls"
```

---

### Task 8: Update `auth-callback.js` — Add One-at-a-Time Enforcement

**Files:**
- Modify: `3complimentaryAI/netlify/functions/auth-callback.js:50-66`

**Step 1: Update the Google callback to clear Microsoft fields and set connected_provider**

In auth-callback.js, modify the `updateData` object (around line 51) to also clear Microsoft fields:

```javascript
        // Keep existing refresh token if Google didn't return a new one
        const updateData = {
            avatar_url: profile.picture || null,
            google_access_token: tokens.access_token,
            google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
            connected_provider: 'google',
            // Clear Microsoft fields (one-at-a-time enforcement)
            microsoft_access_token: null,
            microsoft_refresh_token: null,
            microsoft_token_expiry: null,
            updated_at: new Date().toISOString(),
        };
```

The rest of the file stays the same.

**Step 2: Commit**

```bash
git add 3complimentaryAI/netlify/functions/auth-callback.js
git commit -m "feat: auth-callback clears Microsoft fields on Google connect"
```

---

### Task 9: Update `google-disconnect.js` — Set `connected_provider = null`

**Files:**
- Modify: `3complimentaryAI/netlify/functions/google-disconnect.js:42-48`

**Step 1: Add `connected_provider: null` to the update**

```javascript
        // Clear Google fields from user record
        await supabase.from('users').update({
            google_access_token: null,
            google_refresh_token: null,
            google_token_expiry: null,
            avatar_url: null,
            connected_provider: null,
            updated_at: new Date().toISOString(),
        }).eq('id', decoded.userId);
```

**Step 2: Commit**

```bash
git add 3complimentaryAI/netlify/functions/google-disconnect.js
git commit -m "feat: google-disconnect sets connected_provider to null"
```

---

### Task 10: Update `user-disconnect.js` — Clear Microsoft Tokens on Account Delete

**Files:**
- Modify: `3complimentaryAI/netlify/functions/user-disconnect.js:24-29`

**Step 1: Update the select to also fetch microsoft_access_token**

Change line 26 from:
```javascript
            .select('google_access_token')
```
to:
```javascript
            .select('google_access_token, microsoft_access_token')
```

No other changes needed — the user row is deleted entirely (line 42), which removes all Microsoft fields too. The select is just for the Google token revocation attempt.

**Step 2: Commit**

```bash
git add 3complimentaryAI/netlify/functions/user-disconnect.js
git commit -m "feat: user-disconnect acknowledges Microsoft tokens"
```

---

### Task 11: Update `auth-session.js` — Return `connected_provider`

**Files:**
- Modify: `3complimentaryAI/netlify/functions/auth-session.js:32-53`

**Step 1: Add `connected_provider` and `microsoft_access_token` to the select**

Change line 33 from:
```javascript
            .select('id, email, name, avatar_url, calendar_id, send_time, timezone, is_active, theme_preference, strategic_goals, google_access_token, created_at')
```
to:
```javascript
            .select('id, email, name, avatar_url, calendar_id, send_time, timezone, is_active, theme_preference, strategic_goals, google_access_token, microsoft_access_token, connected_provider, created_at')
```

**Step 2: Update the response to include `connected_provider` and compute `microsoft_connected`**

Replace lines 46-53 with:

```javascript
        // Compute connection flags, strip raw tokens
        const google_connected = !!user.google_access_token;
        const microsoft_connected = !!user.microsoft_access_token;
        const connected_provider = user.connected_provider || null;
        delete user.google_access_token;
        delete user.microsoft_access_token;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: { ...user, google_connected, microsoft_connected, connected_provider } }),
        };
```

**Step 3: Commit**

```bash
git add 3complimentaryAI/netlify/functions/auth-session.js
git commit -m "feat: auth-session returns connected_provider and microsoft_connected"
```

---

### Task 12: Update `index.html` — Add Microsoft Account Card

**Files:**
- Modify: `3complimentaryAI/public/index.html:492-509`

**Step 1: Add Microsoft account card after the Google account card**

After the closing `</div>` of `#google-account-card` (after line 509), add:

```html
                    <!-- Microsoft Account -->
                    <div class="form-card" id="microsoft-account-card">
                        <h3 class="form-card-title">
                            <span>🪟</span> Microsoft Account
                        </h3>
                        <div id="microsoft-not-connected">
                            <p class="form-hint" style="font-size:0.9rem; margin-bottom:var(--space-md);">
                                Connect your Microsoft account to unlock Meeting Briefs, Priority Alignment, and Inbox Summary using Outlook, OneDrive, and To Do.
                            </p>
                            <button type="button" class="btn btn-primary" onclick="handleConnectMicrosoft()">Connect Microsoft Account</button>
                        </div>
                        <div id="microsoft-connected-info" style="display:none;">
                            <p style="color:var(--success-text); font-size:0.9rem; margin-bottom:var(--space-md);">
                                Microsoft account connected — all features unlocked.
                            </p>
                            <button type="button" class="btn btn-outline btn-sm" onclick="handleDisconnectMicrosoft()">Disconnect Microsoft</button>
                        </div>
                    </div>
```

**Step 2: Update the feature gate overlay text to be provider-agnostic**

Change the 3 gate overlays (lines 291-293, 315, 339) from:
```html
<p>🔗 Connect your Google account in <a href="#" onclick="showSection('profile', event)">Settings</a> to use this feature.</p>
```
to:
```html
<p>🔗 Connect your Google or Microsoft account in <a href="#" onclick="showSection('profile', event)">Settings</a> to use this feature.</p>
```

**Step 3: Update the "How It Works" section (line 103) from "Connect Your Google" to "Connect Your Account"**

Change:
```html
<h3>Connect Your Google</h3>
<p>Sign in with Google and grant access to Calendar, Gmail, and Drive. Your data stays secure and encrypted.</p>
```
to:
```html
<h3>Connect Your Account</h3>
<p>Connect Google or Microsoft and grant access to Calendar, Email, and Cloud Storage. Your data stays secure and encrypted.</p>
```

**Step 4: Commit**

```bash
git add 3complimentaryAI/public/index.html
git commit -m "feat: add Microsoft Account card and update gate overlays"
```

---

### Task 13: Update `app.js` — Add Microsoft Connect/Disconnect + Update UI Logic

**Files:**
- Modify: `3complimentaryAI/public/js/app.js`

**Step 1: Add Microsoft connect/disconnect functions after line 213 (after `handleDisconnectGoogle`)**

```javascript
// ─── Microsoft Connect / Disconnect ───
function handleConnectMicrosoft() {
    window.location.href = `${CONFIG.apiBase}/auth-microsoft`;
}

async function handleDisconnectMicrosoft() {
    if (!confirm('Disconnect Microsoft? Features like Briefs, Priorities, and Inbox will be unavailable until you reconnect.')) {
        return;
    }

    showLoading(true);

    try {
        const response = await fetch(`${CONFIG.apiBase}/microsoft-disconnect`, {
            method: 'POST',
            credentials: 'include',
        });

        if (response.ok) {
            currentUser.microsoft_connected = false;
            currentUser.connected_provider = null;
            currentUser.avatar_url = null;
            updateUserUI();
            showToast('Microsoft account disconnected.');
        } else {
            showToast('Failed to disconnect Microsoft. Please try again.');
        }
    } catch (err) {
        showToast('Network error. Please check your connection.');
    }

    showLoading(false);
}
```

**Step 2: Update `checkSession()` (around line 236-240) to handle `?microsoft=connected`**

After the existing Google connected check, add:

```javascript
    if (params.get('microsoft') === 'connected') {
        window.history.replaceState({}, '', '/');
        showToast('Microsoft account connected successfully!');
    }
```

**Step 3: Update `updateUserUI()` to use `connected_provider` for feature gating**

Replace the `updateUserUI` function (lines 272-336). Key changes:

1. Change line 277 from:
```javascript
    const googleConnected = !!currentUser.google_connected;
```
to:
```javascript
    const googleConnected = !!currentUser.google_connected;
    const microsoftConnected = !!currentUser.microsoft_connected;
    const anyConnected = googleConnected || microsoftConnected;
    const providerName = currentUser.connected_provider === 'microsoft' ? 'Microsoft' : 'Google';
```

2. Change the connection status text (line 287):
```javascript
    setElementText('connection-status', anyConnected ? `${providerName} Connected` : 'Not Connected');
```

3. Update status card border color (line 290):
```javascript
        statusCard.style.borderColor = anyConnected ? 'rgba(56, 239, 125, 0.3)' : 'rgba(255, 107, 107, 0.3)';
```

4. Update feature gate overlays (lines 296-300):
```javascript
    gateIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = anyConnected ? 'none' : 'flex';
    });
```

5. Update Google account card visibility (lines 303-306):
```javascript
    const notConnEl = document.getElementById('google-not-connected');
    const connEl = document.getElementById('google-connected-info');
    if (notConnEl) notConnEl.style.display = googleConnected ? 'none' : 'block';
    if (connEl) connEl.style.display = googleConnected ? 'block' : 'none';
```

6. Add Microsoft account card visibility after that:
```javascript
    // Microsoft account card in profile
    const msNotConnEl = document.getElementById('microsoft-not-connected');
    const msConnEl = document.getElementById('microsoft-connected-info');
    if (msNotConnEl) msNotConnEl.style.display = microsoftConnected ? 'none' : 'block';
    if (msConnEl) msConnEl.style.display = microsoftConnected ? 'block' : 'none';
```

**Step 4: Update `handleDisconnectGoogle` (line 201-203) to also clear `connected_provider`**

Add after line 201:
```javascript
            currentUser.connected_provider = null;
```

**Step 5: Update `handleDisconnect` (delete account) toast message (line 421)**

Change from:
```javascript
            showToast('✅ Account deleted and Google disconnected.');
```
to:
```javascript
            showToast('✅ Account deleted successfully.');
```

**Step 6: Commit**

```bash
git add 3complimentaryAI/public/js/app.js
git commit -m "feat: add Microsoft connect/disconnect UI + provider-aware feature gating"
```

---

### Task 14: Update `generate-brief.js` — Add Microsoft Graph Support

**Files:**
- Modify: `3complimentaryAI/netlify/functions/generate-brief.js`

This is the largest change. The function needs to branch on `connected_provider` and use either Google APIs or Microsoft Graph.

**Step 1: Add microsoft-graph require at the top**

After the existing requires, add:
```javascript
const msGraph = require('./microsoft-graph');
```

**Step 2: Update the user select to include Microsoft fields**

Add `microsoft_access_token, microsoft_refresh_token, microsoft_token_expiry, connected_provider` to the Supabase `.select()` query.

**Step 3: Add provider branching**

After fetching the user, add provider detection:
```javascript
const provider = user.connected_provider || (user.google_access_token ? 'google' : null);
if (!provider) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No account connected' }) };
}
```

**Step 4: Create Microsoft-specific data fetching functions**

For each Google API call in the function, add a Microsoft branch. The exact implementation depends on the structure of generate-brief.js, but the pattern is:

```javascript
let events, emailContext, driveFiles;

if (provider === 'microsoft') {
    const accessToken = await msGraph.refreshMicrosoftToken(user);
    events = await msGraph.getCalendarEvents(accessToken, startOfDay.toISOString(), endOfDay.toISOString());
    // ... transform to match the format expected by the AI prompt
} else {
    // existing Google code
}
```

**Step 5: Create Microsoft email sending branch**

```javascript
if (provider === 'microsoft') {
    const accessToken = await msGraph.refreshMicrosoftToken(user);
    await msGraph.sendEmail(accessToken, user.email, emailHtml.subject, emailHtml.html);
} else {
    // existing Google Gmail send code
}
```

**Step 6: Commit**

```bash
git add 3complimentaryAI/netlify/functions/generate-brief.js
git commit -m "feat: generate-brief supports Microsoft Graph for calendar, mail, drive"
```

---

### Task 15: Update `generate-priorities.js` — Add Microsoft Graph Support

**Files:**
- Modify: `3complimentaryAI/netlify/functions/generate-priorities.js`

Same pattern as Task 14:

**Step 1: Add `require('./microsoft-graph')` at top**

**Step 2: Update user select to include Microsoft fields + `connected_provider`**

**Step 3: Add provider branching for:**
- Calendar events → `msGraph.getCalendarEvents()`
- Priority emails → `msGraph.getImportantEmails()`
- Tasks → `msGraph.getTodoTasks()`
- Send email → `msGraph.sendEmail()`

**Step 4: Commit**

```bash
git add 3complimentaryAI/netlify/functions/generate-priorities.js
git commit -m "feat: generate-priorities supports Microsoft Graph"
```

---

### Task 16: Update `inbox-summary.js` — Add Microsoft Graph Support

**Files:**
- Modify: `3complimentaryAI/netlify/functions/inbox-summary.js`

Same pattern as Task 14:

**Step 1: Add `require('./microsoft-graph')` at top**

**Step 2: Update user select to include Microsoft fields + `connected_provider`**

**Step 3: Add provider branching for:**
- Important/unread/flagged emails → `msGraph.getImportantEmails()`
- Send email → `msGraph.sendEmail()`

**Step 4: Update email link generation**

Google uses `gmailLink` format (`https://mail.google.com/mail/#inbox/ID`). For Microsoft, use the `webLink` property returned by Graph API, or build Outlook Web links: `https://outlook.office365.com/mail/inbox/id/ID`.

**Step 5: Commit**

```bash
git add 3complimentaryAI/netlify/functions/inbox-summary.js
git commit -m "feat: inbox-summary supports Microsoft Graph"
```

---

### Task 17: Manual Testing

**No files to modify — this is a verification task.**

**Step 1: Start local dev server**

```bash
cd 3complimentaryAI && npm run dev
```

**Step 2: Test Google flow still works**

1. Sign in with email
2. Connect Google → verify redirect, toast, features unlocked
3. Generate brief → verify it works
4. Disconnect Google → verify features locked

**Step 3: Test Microsoft flow**

1. Sign in with email
2. Go to Settings → Connect Microsoft Account
3. Complete Microsoft consent screen
4. Verify redirect to `/?microsoft=connected`, toast shows
5. Verify connection status shows "Microsoft Connected"
6. Verify feature gates removed
7. Generate brief → verify it pulls from Outlook Calendar
8. Disconnect Microsoft → verify features locked

**Step 4: Test one-at-a-time switching**

1. Connect Google → verify Microsoft fields cleared
2. Connect Microsoft → verify Google fields cleared
3. Verify UI shows correct provider name

---

### Task 18: Update `.env.example` and Add Production Redirect URI

**Files:**
- Modify: `3complimentaryAI/.env.example` (if not done in Task 2)

**Step 1: Remind to add production redirect URI**

In Azure portal → App registrations → Authentication → Add platform → Web:
- Add: `https://YOUR-NETLIFY-SITE.netlify.app/.netlify/functions/auth-microsoft-callback`

**Step 2: Add Netlify environment variables**

In Netlify Dashboard → Site settings → Environment variables:
- `MICROSOFT_CLIENT_ID` = your Azure client ID
- `MICROSOFT_CLIENT_SECRET` = your Azure client secret

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: Microsoft connection — complete implementation"
```
