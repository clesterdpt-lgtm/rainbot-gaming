# 🌧 Escape the Strait

> Silly, meme-worthy browser games. Free with ads, or skip the ads with Pro.

A static HTML5 + vanilla JS gaming site. No build step, no backend required to play. Drop it on any static host and you're live.

## 🎮 Games

| Status | Game | Notes |
| --- | --- | --- |
| ✅ Live | **AI Slop Factory** | Conveyor-belt content moderation panic. Sort cursed AI thumbnails, bot floods, scams, misinformation, and ragebait before the feed overloads. `/games/ai-slop-factory.html` |
| ✅ Live | **Escape the Strait of Hormuz** | Frogger-style. You're a VLCC oil tanker. `/games/strait-of-hormuz.html` |
| ✅ Live | **Mr Feast's Mansion** | First-person architectural exploration through a furnished three-floor estate in a lightning storm. `/games/mr-feast-mansion.html` |
| ✅ Live | **Looksmaxxing Grindset** | Clicker parody. Wake up sadge, become gigachad. `/games/looksmaxxing-grindset.html` |
| ✅ Live | **DoorCrash: No Tip Nitro** | 3D food-delivery lane runner. Keep the fries hot, dodge city chaos, and survive the no-tip economy. `/games/doorcrash-no-tip-nitro.html` |
| ✅ Live | **Apop Demon Moggers** | 2D side-scroller. America's pop divas run-and-gun a demon boy band off the charts. Final boss: Lucifer Lipsync of Boyz II Hell. `/games/apop-demon-hunters.html` |
| ✅ Live | **AGAIN.** | 🕯 *Rainbot After Dark No. 001* — first-person loop-horror in the spirit of P.T. Three.js hallway, 100% synthesized positional audio (no sound files). Headphones required. **Not a parody.** `/games/again.html` |
| ✅ Live | **Boomer Monopoly** | Satirical housing board game. Roll, buy, renovate, and collect rent. `/games/boomer-monopoly.html` |
| ✅ Live | **Billionaire Space Race** | Lunar-lander parody. Burn the investor money, dodge lawsuit drones and audit satellites, and set your ego-rocket down gently on an ever-tinier, ever-moving platform. `/games/billionaire-space-race.html` |
| 🧪 Prototype | **Unhoused and Unhinged** | Low-poly 3D street-survival sandbox. Perform slapstick antics by day, manage heat, and survive Tweeker Zombies with improvised comedy weapons at night. `/games/unhoused-and-unhinged.html` |
| ✅ Live | **Scrap Circuit: Last Chassis Standing** | PS1-era arena vehicular combat parody. Ten unhinged service vehicles, six destructible arenas, weapon pickups, signature specials, and an insurance-adjuster announcer. Play a single match or the six-arena **Circuit** where damage carries over and repairs cost your Salvage. Rendered at 270p with vertex wobble, fog, and dither on purpose. `/games/scrap-circuit.html` |

> ⚠️ **All games are parody / satire** — except the *After Dark* line, which is original horror fiction. AI Slop Factory satirizes platform incentives, content moderation dashboards, AI slop, and engagement farming; it is not affiliated with any real platform, sponsor, or moderation vendor. Mr. Feast is a fictional character parodying a well-known YouTube challenge format. Looksmaxxing Grindset is a satirical sendup of "looksmaxxing" / "gym-bro" internet culture. DoorCrash is a fictional delivery-app chaos parody and is not affiliated with any real delivery brand. Apop Demon Moggers is a fictional side-scroller satirizing American pop culture and internet "mogging" slang; the demon "boy band" and all characters are invented parodies with no relation to any real person, group, organization, or community. Billionaire Space Race satirizes the private-spaceflight ambitions of fictional tech billionaires; all tycoons, companies, and rockets are invented parodies with no relation to any real person or company. Unhoused and Unhinged satirizes absurd city systems, clout culture, and cartoon survival-game logic; it should not frame real homelessness or addiction as the punchline. Scrap Circuit: Last Chassis Standing is an original parody of PS1-era arena vehicular-combat games and late-capitalist service economies; all vehicles, drivers, arenas, and the announcer are invented, the demolition is cartoon-only, and it is not affiliated with or based on any real game, brand, vehicle, or person. Not affiliated with any real brand, person, or community.

## 🚀 Run it locally

For **Mr Feast's Mansion on macOS**, double-click `Open Mr Feast Mansion.command` in this folder. It starts a loopback-only server and opens the mansion automatically.

To serve the whole static site manually, either of these works:

```bash
# Python (no install)
python3 -m http.server 8000

# Node
npx http-server -p 8000
```

Then open <http://localhost:8000>.

Do not open the mansion HTML with a `file://` address. Its local physics module requires the web server above.

## 📁 Project layout

```
.
├── index.html                    # Landing page
├── games.html                    # Game selector
├── games/
│   ├── ai-slop-factory.html      # Playable content-moderation arcade parody
│   ├── strait-of-hormuz.html     # Playable Frogger
│   ├── boomer-monopoly.html      # Playable board-game parody
│   ├── apop-demon-hunters.html   # Playable side-scroller (Apop Demon Moggers)
│   └── unhoused-and-unhinged.html # Low-poly 3D sandbox prototype
├── assets/
│   ├── css/styles.css            # All styles
│   └── js/
│       ├── ads.js                # Ad + subscription + power-up state machine
│       ├── main.js               # Nav, Pro modal, site-wide UI
│       ├── boomer-monopoly.js    # Board-game parody engine
│       ├── strait-of-hormuz.js   # Game engine
│       └── unhoused-and-unhinged-topdown.js # Top-down sandbox prototype engine
├── legal/
│   ├── privacy.html
│   └── terms.html
└── README.md
```

## 💸 Monetization

Two revenue streams, both wired in `assets/js/ads.js`:

### 1. Ads (free users)

The mock rewarded ad in `RB.showRewarded()` simulates a 5-second ad. Replace the body with your SDK of choice. Recommended networks for browser games:

- **Adsterra** — Direct Link (wrap in a real-looking interstitial) or Smart Tag
- **Google AdSense / Ad Manager** — banner slots only; not ideal for rewarded
- **Monetag** — popunder + push, good for "open the app" style
- **Amazon Publisher Services** — if you have volume

For banners, replace the `renderAdSlot()` function with your tag. The HTML pages already have `<div id="ad-leaderboard">` and `<div id="ad-rectangle">` slots ready to fill.

Example AdSense banner:

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXX"
        crossorigin="anonymous"></script>
<ins class="adsbygoogle"
     style="display:block"
     data-ad-client="ca-pub-XXXX"
     data-ad-slot="XXXX"
     data-ad-format="auto"
     data-full-width-responsive="true"></ins>
<script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
```

Drop that in your `renderAdSlot()` function for the right size.

### 2. Pro subscription (no ads)

Mocked locally for now. To go real, integrate one of:

- **Stripe Checkout** (hosted) — easiest, lowest fee
- **Paddle** (MoR) — handles VAT for you
- **Lemon Squeezy** (MoR) — simpler than Paddle, similar
- **RevenueCat Web** — if you also do iOS/Android

The flow:
1. `RB.startCheckout(plan)` calls your backend
2. Backend creates a Stripe Checkout session, returns the URL
3. User pays, Stripe webhook hits your backend
4. Backend marks the user as Pro in your auth table, returns a signed token
5. Frontend stores the token, calls `RB.cancelPro()` to clear locally
6. On every page load, validate the token with your backend

For a no-backend quick start, use Stripe Payment Links and webhook → your email → manual toggle. Not scalable but ships in an afternoon.

## 🎯 Power-ups (ad → reward loop)

In-game power-ups (Shield, Boost, Nuke) are earned by watching a rewarded ad. This is the highest-CPM ad format (~5–10x banner) and is what should drive most of your free-user revenue.

- Shield: 1 free hit
- Boost: next move goes 2 cells
- Nuke: clears the lane closest to the player

Add new power-ups by:
1. Adding a key to `defaultState.powerups` in `ads.js`
2. Adding a button in `renderPowerups()` in `strait-of-hormuz.js`
3. Adding the effect in `usePowerup()`

## 🎨 Brand

Defined in `assets/css/styles.css` `:root`:

- `--bg: #0f0f17` (deep navy)
- `--accent: #ff2e88` (hot pink)
- `--accent-2: #2ee0ff` (cyan)
- `--accent-3: #f7d716` (yellow)

Fonts: Bungee (display), Inter (body), JetBrains Mono (HUD). All loaded from Google Fonts.

## 🌍 Deploy

Any static host. Tested drop-and-go:

- **Netlify**: drag the folder onto netlify.com/drop
- **Vercel**: `vercel deploy`
- **Cloudflare Pages**: connect the repo
- **GitHub Pages**: push to `gh-pages` branch
- **S3 + CloudFront**: `aws s3 sync . s3://your-bucket`

Set the default document to `index.html` and you're done.

## 🛡 Legal / disclaimer

- All games are **parody / satire**. Not affiliated with any real people, organizations, or geopolitical entities.
- Ad networks may set cookies — disclose in your privacy policy.
- Refund / billing handled by your payment processor's standard policy.

## 🤝 Contributing new games

The pattern:
1. Add a `<canvas>` + page under `/games/your-game.html`
2. Add a card to `index.html` and `games.html`
3. Reuse the `<nav class="nav">` and ad slots
4. Use `RB.showRewarded()` for rewarded ads
5. Use `RB.recordScore("your-game-id", score)` for high scores
6. Use `RB.isAdFree()` to gate banners

That's it. No build step. PRs welcome.

---

Made with too much coffee. ☕
