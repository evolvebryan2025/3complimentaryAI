# Meeting Preparation Automation™

AI-powered meeting preparation briefs delivered to your inbox every morning. No n8n required.

## 🏗️ Architecture

| Component | Tech | Purpose |
|-----------|------|---------|
| Frontend | HTML/CSS/JS | Landing page + user dashboard |
| Backend API | Netlify Functions | OAuth, user settings |
| Scheduler | Modal.com | Daily cron job |
| Database | Supabase | User data, tokens, logs |
| AI | OpenAI GPT-3.5 | Meeting brief generation |

## 🚀 Setup Guide

### 1. Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or use existing)
3. Enable these APIs:
   - Google Calendar API
   - Gmail API
   - Google Drive API
4. Go to **Credentials** → Create **OAuth 2.0 Client ID**
   - Application type: Web application
   - Authorized redirect URIs: `https://YOUR-SITE.netlify.app/.netlify/functions/auth-callback`
   - For local dev also add: `http://localhost:8888/.netlify/functions/auth-callback`
5. Copy the Client ID and Client Secret

### 2. Supabase

The database is already set up at project `ahzqnsxcwvspnncuwfjw`.
Get the service role key from: **Supabase Dashboard → Settings → API → Service Role Key**

### 3. Netlify Deployment

```bash
# Install dependencies
cd meeting-prep-app
npm install

# Set up environment variables in Netlify Dashboard:
# - GOOGLE_CLIENT_ID
# - GOOGLE_CLIENT_SECRET
# - SUPABASE_URL
# - SUPABASE_SERVICE_KEY
# - OPENAI_API_KEY
# - JWT_SECRET

# Deploy
netlify deploy --prod
```

### 4. Modal.com (Cron Job)

```bash
# Install Modal
pip install modal

# Create secrets in Modal dashboard
modal secret create meeting-prep-secrets \
  SUPABASE_URL=https://ahzqnsxcwvspnncuwfjw.supabase.co \
  SUPABASE_SERVICE_KEY=your-key \
  OPENAI_API_KEY=sk-your-key \
  GOOGLE_CLIENT_ID=your-id \
  GOOGLE_CLIENT_SECRET=your-secret

# Deploy the cron job
cd modal
modal deploy meeting_prep_cron.py

# Test manually
modal run meeting_prep_cron.py
```

### 5. Local Development

```bash
# Copy env file
cp .env.example .env
# Fill in your values

# Install dependencies
npm install

# Run locally
npx netlify dev
```

## 📁 Project Structure

```
meeting-prep-app/
├── public/                    # Frontend static files
│   ├── index.html            # Main HTML (landing + dashboard)
│   ├── css/styles.css        # Full design system (dark/light)
│   └── js/app.js             # Client-side logic
├── netlify/
│   └── functions/            # Serverless API endpoints
│       ├── auth-google.js    # Initiate OAuth
│       ├── auth-callback.js  # OAuth callback + token exchange
│       ├── auth-session.js   # Check session
│       ├── auth-logout.js    # Logout
│       ├── user-profile.js   # Get/update profile
│       ├── user-disconnect.js # Delete account
│       └── briefing-history.js # Fetch logs
├── modal/
│   └── meeting_prep_cron.py  # Daily cron job (the brain)
├── netlify.toml              # Netlify config
├── package.json              # Dependencies
├── .env.example              # Environment template
└── README.md                 # This file
```

## 🔒 Security

- Google OAuth tokens are stored in Supabase (server-side only)
- Session managed via HTTP-only JWT cookies
- OpenAI API key is server-side only (never exposed to browser)
- RLS enabled on all tables
- Service role key used only by backend functions

## 📧 Support

Contact: [hello@madeeas.com](mailto:hello@madeeas.com)

---

Built by [MadeEA](https://madeeas.com) • Meeting Preparation Automation™
