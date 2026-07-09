-- AI Trainer — Supabase multi-tenant schema
-- Run this ONCE in Supabase Dashboard -> SQL Editor -> New query -> paste all -> Run.
-- Safe to re-run: every statement uses IF NOT EXISTS / OR REPLACE where possible.
-- This schema is purely additive to your GitHub-backed app — it does not touch data/*.json.

-- ============================================================================
-- 1. profiles — one row per user, jsonb blob = the old trainer_profile.json
-- ============================================================================
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  disclaimer_accepted_at timestamptz,
  schema_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 2. workouts — one row per program day (replaces workouts.json)
-- ============================================================================
create table if not exists workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  program_id text,
  day jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

-- ============================================================================
-- 3. exercise_logs — append-only log entries (replaces exercise_log.json)
-- ============================================================================
create table if not exists exercise_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  exercise text not null,
  source text not null default 'manual',
  entry jsonb not null,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 4. goals
-- ============================================================================
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  goal jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 5. weekly_reviews
-- ============================================================================
create table if not exists weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week text not null,
  review jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, week)
);

-- ============================================================================
-- 6. body_metrics — daily weigh-ins
-- ============================================================================
create table if not exists body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight numeric,
  weight_unit text,
  created_at timestamptz not null default now(),
  unique (user_id, date)
);

-- ============================================================================
-- 7. coach_chats — persistent chat history
-- ============================================================================
create table if not exists coach_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  content text not null,
  at timestamptz not null default now()
);

-- ============================================================================
-- 8. Garmin mirrors (optional feature — only populated if user opts into BYO sync)
-- ============================================================================
create table if not exists garmin_activities (
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id bigint not null,
  date date,
  data jsonb not null,
  primary key (user_id, activity_id)
);

create table if not exists garmin_wellness (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  data jsonb not null,
  primary key (user_id, date)
);

create table if not exists garmin_health (
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  data jsonb not null,
  primary key (user_id, date)
);

-- ============================================================================
-- 9. usage — token metering for the coach-proxy quota enforcement
-- ============================================================================
create table if not exists usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,  -- 'YYYY-MM'
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  requests int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);

-- ============================================================================
-- 10. user_settings — per-user quota cap + Garmin ingest token
-- ============================================================================
create table if not exists user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  monthly_token_cap bigint not null default 300000,
  garmin_ingest_token text
);

-- ============================================================================
-- 11. invite_codes — registration gate
-- ============================================================================
create table if not exists invite_codes (
  code text primary key,
  created_by uuid references auth.users(id),
  used_by uuid references auth.users(id),
  used_at timestamptz,
  max_uses int not null default 1,
  uses int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- Auto-create profiles/user_settings row on new user signup
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  insert into public.user_settings (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row Level Security — every user can only ever touch their own rows.
-- usage / user_settings / invite_codes are read-only to users; edge functions
-- (using the service_role key, which bypasses RLS) do the writes.
-- ============================================================================
alter table profiles enable row level security;
alter table workouts enable row level security;
alter table exercise_logs enable row level security;
alter table goals enable row level security;
alter table weekly_reviews enable row level security;
alter table body_metrics enable row level security;
alter table coach_chats enable row level security;
alter table garmin_activities enable row level security;
alter table garmin_wellness enable row level security;
alter table garmin_health enable row level security;
alter table usage enable row level security;
alter table user_settings enable row level security;
alter table invite_codes enable row level security;

-- Full CRUD for the owning user (data tables)
do $$
declare
  t text;
begin
  foreach t in array array['profiles','workouts','exercise_logs','goals','weekly_reviews',
                            'body_metrics','coach_chats','garmin_activities','garmin_wellness','garmin_health']
  loop
    execute format('drop policy if exists "own_rows_select" on %I', t);
    execute format('create policy "own_rows_select" on %I for select using (user_id = auth.uid())', t);
    execute format('drop policy if exists "own_rows_insert" on %I', t);
    execute format('create policy "own_rows_insert" on %I for insert with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own_rows_update" on %I', t);
    execute format('create policy "own_rows_update" on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('drop policy if exists "own_rows_delete" on %I', t);
    execute format('create policy "own_rows_delete" on %I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;

-- Read-only tables (writes happen server-side via service_role in edge functions)
drop policy if exists "own_usage_select" on usage;
create policy "own_usage_select" on usage for select using (user_id = auth.uid());

drop policy if exists "own_settings_select" on user_settings;
create policy "own_settings_select" on user_settings for select using (user_id = auth.uid());

-- invite_codes: no client access at all (validated only inside the signup edge function
-- via service_role, which bypasses RLS) — no policies needed since RLS defaults to deny-all.
