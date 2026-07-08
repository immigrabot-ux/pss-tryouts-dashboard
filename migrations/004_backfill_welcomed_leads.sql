-- Backfill nurture_stage for leads stuck at 'new'
--
-- Problem: 194 leads are stuck at nurture_stage='new' because they were created
-- before the nurture system was implemented. These leads already received their
-- welcome WhatsApp message (whatsapp_send_status='sent') but weren't moved to
-- 'welcomed' stage.
--
-- Solution: Update all existing leads that received welcome messages to 'welcomed'
-- stage so they can progress through the nurture sequence.

UPDATE leads
SET nurture_stage = 'welcomed',
    last_nurture_sent_at = COALESCE(last_nurture_sent_at, created_at)
WHERE nurture_stage = 'new'
  AND whatsapp_send_status = 'sent'
  AND whatsapp_confirmed = false
  AND (hidden IS NULL OR hidden = false)
  AND (status IS NULL OR status != 'dead');

-- Expected: ~194 rows updated
-- After this migration, these leads will enter the nurture sequence at 'welcomed'
-- and progress to 'nudged' after 24 hours from their created_at timestamp.
