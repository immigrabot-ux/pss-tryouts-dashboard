-- Add meta_leadgen_id column for tracking Meta Lead Ads leads
-- Run this in Supabase SQL editor

alter table leads
add column if not exists meta_leadgen_id text unique;

-- Add an index for faster lookups when polling
create index if not exists idx_leads_meta_leadgen_id on leads(meta_leadgen_id) where meta_leadgen_id is not null;

-- Add a comment for documentation
comment on column leads.meta_leadgen_id is 'Meta Lead Ads leadgen_id for deduplication during polling';
