// Bridge Supabase Auth to our JWT cookie session
// Frontend signs in via Supabase Auth, then calls this to get our meetprep_session cookie
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { access_token } = JSON.parse(event.body);
        if (!access_token) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing access_token' }) };
        }

        // 1. Verify the Supabase Auth token server-side
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );

        const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(access_token);

        if (authError || !authUser) {
            return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
        }

        // Reject unverified email
        if (!authUser.email_confirmed_at) {
            return { statusCode: 403, body: JSON.stringify({ error: 'Please verify your email first' }) };
        }

        // 2. Find or create user in public.users
        const { data: existingUser } = await supabase
            .from('users')
            .select('id')
            .eq('email', authUser.email)
            .single();

        let userId;

        if (existingUser) {
            userId = existingUser.id;
        } else {
            const { data: newUser, error: insertErr } = await supabase
                .from('users')
                .insert({
                    email: authUser.email,
                    name: authUser.user_metadata?.name || authUser.email.split('@')[0],
                    updated_at: new Date().toISOString(),
                })
                .select('id')
                .single();

            if (insertErr) throw insertErr;
            userId = newUser.id;
        }

        // 3. Issue our standard JWT cookie (same format all functions expect)
        const jwtSecret = process.env.JWT_SECRET || process.env.ENCRYPTION_KEY;
        const sessionToken = jwt.sign(
            { userId, email: authUser.email },
            jwtSecret,
            { expiresIn: '30d' }
        );

        const sessionCookie = cookie.serialize('meetprep_session', sessionToken, {
            httpOnly: true,
            secure: process.env.URL?.startsWith('https') || false,
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60,
            path: '/',
        });

        console.log('auth-email: session created for userId:', userId, 'email:', authUser.email);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': sessionCookie,
            },
            body: JSON.stringify({ success: true }),
        };
    } catch (err) {
        console.error('auth-email error:', err);
        return { statusCode: 500, body: JSON.stringify({ error: 'Authentication failed' }) };
    }
};
