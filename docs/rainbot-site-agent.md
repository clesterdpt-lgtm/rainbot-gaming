# Rainbot Site Agent

Rainbot can have an official site profile without becoming a forum spam machine. The first version is intentionally conservative:

- The bot uses a normal Supabase Auth account, not a service-role key.
- Drafting and public posting are separate steps.
- Public posts require database approval and rate-limit checks.
- The default mode is draft-only.

## Environment

Keep these values outside the repo, preferably in OpenClaw service/local env:

```bash
export RB_SUPABASE_URL="https://qzvrrpzmalskayushbrv.supabase.co"
export RB_SUPABASE_ANON_KEY="public-anon-key"
export RAINBOT_AGENT_EMAIL="rainbot@example.com"
export RAINBOT_AGENT_PASSWORD="long-random-password"
export RAINBOT_SITE_AGENT_MODE="draft"
```

Do not use a Supabase service-role key in the static site or in this helper.

## Create The Account

Create the Rainbot account through the site UI or Supabase Auth. Then run:

```bash
node scripts/rainbot-site-agent.mjs whoami
```

Copy the returned user id and mark that profile as the official bot in Supabase SQL Editor:

```sql
update public.profiles
set
  display_name = 'Rainbot',
  profile_title = 'Official Site Bot',
  bio = 'Rainbot Network arcade robot. Helpful in small doses.',
  favorite_game = 'The Last Signal',
  avatar_style = 'bot',
  accent_color = 'cyan',
  is_bot = true,
  bot_label = 'Official Bot',
  bot_mode = 'draft',
  bot_posting_enabled = false
where id = 'PASTE_USER_ID_HERE';
```

This setup lets Rainbot queue drafts, but database triggers still reject public posts.

## Draft Examples

```bash
node scripts/rainbot-site-agent.mjs draft-comment \
  --type game \
  --id flappy-stonks \
  --url /games/flappy-stonks.html \
  --title "Flappy Stonks" \
  --body "Strong chart chaos here. Try the shield before chasing dividends."

node scripts/rainbot-site-agent.mjs draft-topic \
  --category ideas \
  --title "Tiny weekend challenge idea" \
  --body "What if one game had a daily seed and a tiny official Rainbot run?"

node scripts/rainbot-site-agent.mjs draft-reply \
  --topic-id 123 \
  --body "Confirmed. I can reproduce this without touching the save file."
```

List queued drafts:

```bash
node scripts/rainbot-site-agent.mjs list-drafts
```

For automated OpenClaw/MiniMax draft creation, see `docs/rainbot-draft-generator.md`.
For Telegram approval buttons, see `docs/rainbot-telegram-approvals.md`.

## Approve And Publish

Approval is a deliberate database step. A moderator/admin can approve one draft:

```sql
update public.agent_actions
set status = 'approved'
where id = 123
  and status = 'draft';
```

Enable limited public posting only when you actually want the helper to publish approved drafts:

```sql
update public.profiles
set
  bot_mode = 'approved',
  bot_posting_enabled = true
where display_name = 'Rainbot'
  and is_bot = true;
```

Then run:

```bash
export RAINBOT_SITE_AGENT_MODE="approved"
node scripts/rainbot-site-agent.mjs post-approved --action-id 123
```

After posting, the database marks the action as `posted`.

## Safety Rules Enforced In The Database

Official bot public posts are blocked unless:

- The profile has `is_bot = true`.
- `bot_posting_enabled = true`.
- `bot_mode` is `approved` or `limited`.
- The post includes an `agent_action_id`.
- That action belongs to the bot and has `status = 'approved'`.

The trigger also blocks:

- More than 3 public bot posts in 24 hours.
- More than 1 bot forum topic in 24 hours.
- Any bot public post within 30 minutes of the previous bot post.
- A second top-level bot comment on the same article, video, or game.
- Bot replies to itself or to its own forum topic.

Keep normal autonomous behavior in `draft` mode until the bot has behaved well for a while.
