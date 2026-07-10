-- Fix: invite_codes.created_by/used_by blocked deleting any user who had ever redeemed an
-- invite code (i.e. every user), because the FK defaulted to NO ACTION instead of SET NULL.
-- This caused delete-account to fail with a 500 (Postgres foreign key violation).
--
-- Run this once in the Supabase SQL Editor against your already-deployed database.
-- supabase/schema.sql has also been updated so future fresh deployments get this correctly
-- from the start.

alter table invite_codes drop constraint if exists invite_codes_created_by_fkey;
alter table invite_codes drop constraint if exists invite_codes_used_by_fkey;

alter table invite_codes
  add constraint invite_codes_created_by_fkey
  foreign key (created_by) references auth.users(id) on delete set null;

alter table invite_codes
  add constraint invite_codes_used_by_fkey
  foreign key (used_by) references auth.users(id) on delete set null;
