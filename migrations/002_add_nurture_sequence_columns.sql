-- Add nurture sequence columns to leads table
-- This enables automated smart nurture with escalating urgency

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS nurture_stage TEXT DEFAULT 'new',
ADD COLUMN IF NOT EXISTS last_nurture_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS nurture_sequence_stopped_reason TEXT;

-- Create index for efficient nurture sequence queries
CREATE INDEX IF NOT EXISTS idx_leads_nurture_stage ON leads(nurture_stage);
CREATE INDEX IF NOT EXISTS idx_leads_last_nurture_sent_at ON leads(last_nurture_sent_at);

COMMENT ON COLUMN leads.nurture_stage IS 'Current stage in nurture sequence: new, welcomed, nudged, urgency_low, urgency_high, converted, stopped';
COMMENT ON COLUMN leads.last_nurture_sent_at IS 'Timestamp of last nurture message sent (any stage)';
COMMENT ON COLUMN leads.nurture_sequence_stopped_reason IS 'Why nurture stopped: replied, opted_out, dead_lead, manual_stop, etc.';
