// Data layer — now backed by Supabase. This file is a thin re-export shim over
// js/supabase/state.js: every lib/view file in this app imports getLocal/refresh/
// refreshAll/save from "../state.js" or "./state.js", and this shim keeps those exact
// import paths working unchanged after the GitHub -> Supabase cutover, so only this file
// (plus app.js and settings.js, which had GitHub/Anthropic-key-specific UI to remove) needed
// to change. See docs/SUPABASE_SETUP.md Part 7.
export { getLocal, refresh, refreshAll, save, isSignedIn, getPrefs, savePrefs } from "./supabase/state.js";
