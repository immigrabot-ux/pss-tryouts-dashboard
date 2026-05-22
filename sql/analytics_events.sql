-- Events sent from peacesoccerschool.com to track visitor behavior.
-- Run in Supabase SQL editor: https://supabase.com/dashboard/project/gdoknipczchcwigoaxqn/sql/new

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- visitor & session
  session_id text,
  visitor_id text,

  -- event identity
  event_type text not null,           -- e.g. "page_view", "form_submit", "click"
  event_name text,                    -- optional human-friendly label

  -- page context
  page_path text,
  page_url text,
  page_title text,
  referrer text,

  -- traffic source (UTM tags)
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,

  -- device / location
  user_agent text,
  device_type text,                   -- "mobile" | "desktop" | "tablet"
  country text,
  region text,
  city text,
  ip text,

  -- everything else
  properties jsonb default '{}'::jsonb
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events (created_at desc);

create index if not exists analytics_events_event_type_idx
  on public.analytics_events (event_type, created_at desc);

create index if not exists analytics_events_session_id_idx
  on public.analytics_events (session_id);

create index if not exists analytics_events_page_path_idx
  on public.analytics_events (page_path);
