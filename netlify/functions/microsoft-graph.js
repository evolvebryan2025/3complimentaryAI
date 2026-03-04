// Microsoft Graph API helper — token refresh + API wrappers
const { createClient } = require('@supabase/supabase-js');

/**
 * Refresh Microsoft access token if expired.
 * Returns the valid access token — updates DB if refreshed.
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
 * Call Microsoft Graph API with bearer token.
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

    // sendMail returns 202 with no body
    if (res.status === 202 || res.headers.get('content-length') === '0') {
        return {};
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
 * Search emails by keyword.
 * Equivalent to Gmail messages.list with q parameter
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
