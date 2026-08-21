// Fill these in ONCE from your Supabase project (Project Settings → API),
// then redeploy. Every HR member who opens the app after that lands
// straight on the sign-in/sign-up screen — nobody has to paste the URL
// or key themselves.
//
// Leave both blank to keep the old behavior: the app asks whoever opens
// it first to paste these in (or skip and run fully offline).
//
// This file only holds the public "anon" key, which is safe to ship in
// a static site — it has no power on its own without a signed-in user,
// and every table it can touch is protected by the Row Level Security
// policies in supabase-schema.sql. Never put a "service_role" key here.
window.FINOTE_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};
