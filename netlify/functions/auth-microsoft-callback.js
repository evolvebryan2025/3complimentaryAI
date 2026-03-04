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
            // Try to get profile photo
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
