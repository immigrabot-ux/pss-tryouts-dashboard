-- Add source tracking column to leads table
-- Run this in Supabase SQL editor

alter table leads
add column if not exists source text default 'website';

-- Add an index for faster filtering by source
create index if not exists idx_leads_source on leads(source);

-- Update existing leads to have 'website' as source if null
update leads set source = 'website' where source is null;

-- Add a comment for documentation
comment on column leads.source is 'Lead source: website, meta_lead_ad, etc.';
