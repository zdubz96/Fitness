// Supabase project config. The anon/public key is DESIGNED to be embedded in client code —
// it's meaningless without Row Level Security, which supabase/schema.sql sets up for every
// table. Fill these in from Supabase Dashboard -> Project Settings -> API before testing
// anything under js/supabase/. This file is not imported by the live app (js/app.js) yet —
// see docs/SUPABASE_SETUP.md for the cutover step.
export const SUPABASE_URL = "REPLACE_WITH_YOUR_PROJECT_URL"; // e.g. https://xxxxx.supabase.co
export const SUPABASE_ANON_KEY = "REPLACE_WITH_YOUR_ANON_KEY";
