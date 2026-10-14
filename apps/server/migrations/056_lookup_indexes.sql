-- Indexes for lookups that scanned whole tables: sign-in and registration compare emails
-- case-insensitively, and reset and verification links look tokens up by their hash.

CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email));
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token_hash
    ON password_reset_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_email_verification_tokens_token_hash
    ON email_verification_tokens (token_hash);
