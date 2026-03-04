-- Add Microsoft OAuth token columns
ALTER TABLE users
ADD COLUMN IF NOT EXISTS microsoft_access_token text,
ADD COLUMN IF NOT EXISTS microsoft_refresh_token text,
ADD COLUMN IF NOT EXISTS microsoft_token_expiry timestamptz,
ADD COLUMN IF NOT EXISTS connected_provider text;

-- Backfill connected_provider for existing Google users
UPDATE users
SET connected_provider = 'google'
WHERE google_access_token IS NOT NULL;
