# Rainbot Supabase Backend

This repo now has a backend-ready account, forum, content-comment, cloud-save, and high-score layer. It stays disabled until Supabase is configured.

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
-- Then run:
-- supabase/migrations/20260625002000_profile_customization.sql
-- supabase/migrations/20260625003000_profile_avatar_art.sql
-- supabase/migrations/20260628000000_content_comments.sql
```

The migration creates:

- `profiles`
- `game_saves`
- `game_scores`
- `forum_topics`
- `forum_replies`
- `forum_reports`
- `content_comments`
- `content_comment_votes`
- RLS policies and indexes
- `record_high_score(...)` for atomic leaderboard updates
- moderation RPCs for hiding replies, hiding/locking/pinning topics, and closing reports

The profile customization migrations add public forum identity fields to `profiles`: title, bio, favorite game, avatar style, and accent color. The avatar art migrations expand `avatar_style` to the generated 42-choice avatar set used by the profile picker, including 22 funny avatar options. The content comments migration adds Reddit-style comment threads and voting for game pages, Rainbot TV clips, and Slopwire articles.

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

## 5. Moderators

Forum moderator tools appear only when the signed-in profile has `role` set to `moderator` or `admin`.

Run this in Supabase SQL Editor for a trusted account:

```sql
update public.profiles
set role = 'admin'
where id = 'USER_UUID_HERE';
```

Use `moderator` instead of `admin` if you want a non-owner moderation account.

## 6. Smoke test

1. Open `community.html`.
2. Create an account with email/password or send yourself a magic link.
3. Set a display name, title, bio, favorite game, generated avatar, and accent color from the Profile modal.
4. Create a forum topic and reply.
5. Open a game page, article page, or Rainbot TV clip and post a comment.
6. Upvote/downvote a comment.
7. Play a game with a saved run, sign in, and use Profile > Sync Now.
8. Confirm rows appear in `profiles`, `forum_topics`, `forum_replies`, `content_comments`, `content_comment_votes`, `game_saves`, and `game_scores`.
9. Report a topic or reply.
10. Sign in with a moderator/admin profile, open the Moderation board, and hide/lock/pin from the report queue.
