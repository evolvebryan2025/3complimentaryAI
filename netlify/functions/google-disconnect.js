// Disconnect Google — Revoke tokens without deleting account
const { createClient } = require('@supabase/supabase-js');
const { google } = require('googleapis');
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

        // Get current tokens to revoke
        const { data: user } = await supabase
            .from('users')
            .select('google_access_token')
            .eq('id', decoded.userId)
            .single();

        // Revoke Google token
        if (user?.google_access_token) {
            try {
                const oauth2Client = new google.auth.OAuth2();
                await oauth2Client.revokeToken(user.google_access_token);
            } catch (e) {
                console.log('Token revocation note:', e.message);
            }
        }

        // Clear Google fields from user record
        await supabase.from('users').update({
            google_access_token: null,
            google_refresh_token: null,
            google_token_expiry: null,
            avatar_url: null,
            updated_at: new Date().toISOString(),
        }).eq('id', decoded.userId);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: true }),
        };
    } catch (err) {
        console.error('Google disconnect error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Failed to disconnect Google' }) };
    }
};
