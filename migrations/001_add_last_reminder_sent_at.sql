-- Add last_reminder_sent_at column to leads table
-- This tracks when we last sent a reminder WhatsApp (using pss_reminder template)
-- Used to enforce 24-hour guard against duplicate reminder sends

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.last_reminder_sent_at IS 'Timestamp of last reminder WhatsApp sent (pss_reminder template). Used to enforce 24-hour send guard.';
