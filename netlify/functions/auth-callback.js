// Google OAuth Callback — Exchange code for tokens, create/update user in Supabase
const { google } = require('googleapis');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

exports.handler = async (event) => {
    const code = event.queryStringParameters?.code;

    if (!code) {
        return {
            statusCode: 302,
            headers: { Location: '/?auth=error&reason=no_code' },
        };
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${process.env.URL || 'http://localhost:8888'}/.netlify/functions/auth-callback`;
    const jwtSecret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;

    try {
        // Exchange authorization code for tokens
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user profile from Google
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: profile } = await oauth2.userinfo.get();

        // Initialize Supabase client
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        // Upsert user in database
        const userData = {
            email: profile.email,
            name: profile.name || profile.email.split('@')[0],
            avatar_url: profile.picture || null,
            google_access_token: tokens.access_token,
            google_refresh_token: tokens.refresh_token || null,
            google_token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
            updated_at: new Date().toISOString(),
        };

        // Check if user exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('id, google_refresh_token')
            .eq('email', profile.email)
            .single();

        let userId;

        if (existingUser) {
            // Update existing user — keep refresh token if not provided
            if (!userData.google_refresh_token && existingUser.google_refresh_token) {
                userData.google_refresh_token = existingUser.google_refresh_token;
            }

            const { error } = await supabase
                .from('users')
                .update(userData)
                .eq('id', existingUser.id);

            if (error) throw error;
            userId = existingUser.id;
        } else {
            // Create new user
            const { data: newUser, error } = await supabase
                .from('users')
                .insert(userData)
                .select('id')
                .single();

            if (error) throw error;
            userId = newUser.id;
        }

        // Create a session JWT
        const sessionToken = jwt.sign(
            { userId, email: profile.email },
            jwtSecret,
            { expiresIn: '30d' }
        );

        // Set session cookie and redirect
        const sessionCookie = cookie.serialize('meetprep_session', sessionToken, {
            httpOnly: true,
            secure: process.env.URL?.startsWith('https') || false,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60, // 30 days
            path: '/',
        });

        return {
            statusCode: 302,
            headers: {
                Location: '/?auth=success',
                'Set-Cookie': sessionCookie,
            },
        };
    } catch (error) {
        console.error('Auth callback error:', error);
        return {
            statusCode: 302,
            headers: { Location: `/?auth=error&reason=${encodeURIComponent(error.message)}` },
        };
    }
};
