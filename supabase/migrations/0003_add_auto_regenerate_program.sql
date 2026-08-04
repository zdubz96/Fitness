-- Adds the opt-in toggle for automatic weekly program regeneration (Sunday cron via
-- weekly-program-cron edge function). Off by default — nobody gets surprise token usage
-- without choosing it. Users can update this one column themselves (same column-level-GRANT +
-- row-level-policy pattern already used for garmin_ingest_token); monthly_token_cap stays
-- admin-only.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.

alter table user_settings add column if not exists auto_regenerate_program boolean not null default false;

grant update (auto_regenerate_program) on user_settings to authenticated;

drop policy if exists "own_settings_update_auto_regen" on user_settings;
create policy "own_settings_update_auto_regen" on user_settings
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
