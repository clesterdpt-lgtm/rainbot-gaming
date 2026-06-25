# Rainbot Supabase Backend

This repo now has a backend-ready account, forum, cloud-save, and high-score layer. It stays disabled until Supabase is configured.

## 1. Create the Supabase project

Create a Supabase project, then open Project Settings > API and copy:

- Project URL
- anon public key

Do not put a service role key in this static site.

## 2. Run the migration

Open Supabase SQL Editor and run:

```sql
-- Paste the full contents of:
-- supabase/migrations/20260624000000_rainbot_accounts_forum.sql
```

The migration creates:

- `profiles`
- `game_saves`
- `game_scores`
- `forum_topics`
- `forum_replies`
- `forum_reports`
- RLS policies and indexes
- `record_high_score(...)` for atomic leaderboard updates

## 3. Enable the frontend config

Edit `assets/js/supabase-config.js`:

```js
window.RB_SUPABASE_CONFIG = {
  enabled: true,
  url: "YOUR_PROJECT_URL",
  anonKey: "YOUR_ANON_PUBLIC_KEY",
  emailRedirectTo: "YOUR_LIVE_FORUM_URL",
};
```

If you publish with a real Supabase URL in source, add that exact host to `scripts/approved-external-hosts.txt`.

## 4. Configure Auth

In Supabase Auth settings:

- Add the live site URL to allowed redirect URLs.
- For local testing, add your localhost URL.
- Email/password and magic links share the same Supabase profiles.
- To enable Google login, create a Google OAuth client, then add its client ID and secret in Supabase Auth > Sign In / Providers > Google.

## 5. Smoke test

1. Open `community.html`.
2. Create an account with email/password or send yourself a magic link.
3. Set a display name from the Profile modal.
4. Create a forum topic and reply.
5. Play a game with a saved run, sign in, and use Profile > Sync Now.
6. Confirm rows appear in `profiles`, `forum_topics`, `forum_replies`, `game_saves`, and `game_scores`.
