-- Let a user generate/rotate their OWN garmin_ingest_token from the app, without opening up
-- monthly_token_cap (which must stay admin-only — otherwise a user could raise their own
-- quota). Postgres lets you combine a column-level GRANT with a row-level RLS policy to get
-- exactly "this user may update only this one column on their own row."
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.

grant update (garmin_ingest_token) on user_settings to authenticated;

drop policy if exists "own_settings_update_ingest_token" on user_settings;
create policy "own_settings_update_ingest_token" on user_settings
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
