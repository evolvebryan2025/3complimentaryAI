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
