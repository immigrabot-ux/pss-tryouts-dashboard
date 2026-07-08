-- Create nurture_config table for dynamic nurture system settings
-- This allows admins to control the system from the dashboard without touching env vars

CREATE TABLE IF NOT EXISTS nurture_config (
  id INT PRIMARY KEY DEFAULT 1,
  dry_run BOOLEAN DEFAULT true,
  paused BOOLEAN DEFAULT false,
  rate_limit_per_hour INT DEFAULT 15,
  tryout_info TEXT DEFAULT 'Saturday July 25 at 10 AM at Bliss Fields, Rehoboth MA',
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Insert default config (only one row allowed)
INSERT INTO nurture_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_nurture_config_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nurture_config_updated_at
  BEFORE UPDATE ON nurture_config
  FOR EACH ROW
  EXECUTE FUNCTION update_nurture_config_timestamp();

COMMENT ON TABLE nurture_config IS 'Dynamic configuration for automated nurture sequence system';
COMMENT ON COLUMN nurture_config.dry_run IS 'If true, log what would be sent but do not actually send';
COMMENT ON COLUMN nurture_config.paused IS 'Master pause flag - if true, nurture cron does nothing';
COMMENT ON COLUMN nurture_config.rate_limit_per_hour IS 'Maximum nurture messages to send per cron run';
COMMENT ON COLUMN nurture_config.tryout_info IS 'Default tryout information for template parameter {{3}}';
