// Google OAuth — "Connect Google" step (requires existing session)
const { google } = require('googleapis');
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

    // 2. Build Google OAuth URL with userId in signed state
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/auth-callback`;
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const scopes = [
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/tasks.readonly',
    ];

    // Sign the state for security
    const state = jwt.sign({ userId }, jwtSecret, { expiresIn: '10m' });

    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent',
        include_granted_scopes: true,
        state,
    });

    return {
        statusCode: 302,
        headers: { Location: authUrl },
    };
};
