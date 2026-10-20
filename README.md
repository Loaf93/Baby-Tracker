# Baby Day: setup guide

A home-screen app for tracking sleep, feeds, awake time and nappies, with Sims bars and insights.
Data syncs between phones through a **private** GitHub repo.

```
baby-tracker  (PUBLIC repo → GitHub Pages)   holds only the app code
baby-data     (PRIVATE repo)                  holds the data: data/2026-10.json, data/2026-11.json …
```

---

## 1. Create the private data repo (2 min)

1. On github.com, click **+ → New repository**.
2. Name: `baby-data`. Select **Private**. Tick **Add a README file**.
3. Click **Create repository**.

## 2. Create the app repo and turn on GitHub Pages (5 min)

1. **+ → New repository**. Name: `baby-tracker`. Select **Public**. Tick **Add a README file**. Click **Create**.
2. In the new repo, click **Add file → Upload files**. Drag in **everything inside** the unzipped `baby-tracker` folder: `index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, and the `js/` and `icons/` folders. Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main**, folder **/ (root)**. Click **Save**.
4. After about a minute the app is live at `https://YOUR-USERNAME.github.io/baby-tracker/`

> The public repo contains no baby data. Everything personal lives in `baby-data`.

## 3. Create a token that can only touch `baby-data` (3 min)

1. Go to GitHub **Settings** (your avatar → Settings) → **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
2. **Token name:** `baby-day`. **Expiration:** the longest available. Add a calendar reminder to renew it.
3. **Repository access:** *Only select repositories* → `baby-data`.
4. **Permissions → Repository permissions → Contents: Read and write**. Metadata becomes read-only automatically; that's expected.
5. Click **Generate token** and copy it (it starts with `github_pat_`). You won't see it again.

## 4. Install on her iPhone

1. Open `https://YOUR-USERNAME.github.io/baby-tracker/` in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. **Open the app from the home-screen icon.** iPhone keeps home-screen apps' storage separate from Safari, so the settings have to be entered inside the installed app.
4. Tap ⚙️ and fill in:
   - GitHub username, repo `baby-data`, and the token. Tap **Save & test**. You should see *Connected to private repo ✓*.
   - **Your name**, e.g. "Mum", then tap **Save preferences**.

## 5. Add your phone (30 seconds)

1. On her phone: ⚙️ → **Copy my code**. AirDrop or privately message it to yourself, then delete the message.
2. On your phone: install from Safari as in step 4, open from the home screen, go to ⚙️, paste the code into **Paste setup code**, and tap **Use code**.
3. Set **Your name** to e.g. "Dad".

---

## How it works

| | |
|---|---|
| **Sleep / Feed / Awake** | Exactly one is running at a time. Tapping a new one ends the current one, so the Sims bar never has gaps. |
| **Sleep** | Pick Bassinet / Co-sleep / Carrier. Tap a different place mid-sleep to record a transfer. |
| **Feed** | Pick L / R (the suggested side is outlined: the opposite of the side the last feed *started* on). Tap the other side mid-feed to switch. **Finish feed** starts Awake. |
| **12am–8am** | Starting an event shows **"5 / 10 / 15 … min ago"** chips for when you forgot to tap. |
| **Nappies** | One tap: Wee / Poo / Both. Every action shows **Undo** for a few seconds. |
| **Wake window** | The bar turns amber at 80% of the target (default 75 min) and coral once it's passed. Feeds count as awake time. Change the target in Settings as baby grows. |
| **Tonight view** | Between 12am and 8am the bar shows **Tonight (8pm–8am)** so the whole night is visible, with sleep so far, longest stretch and feeds. Tap **Today** to switch back. |
| **Predictions** | "Next ~1:40am · R side" uses the usual gap between feed starts *at this time of day* (night gaps are longer), from the last few days. While awake, the wake-window bar shows **Sleep due ~3:15pm**. Tap a chip to see how it was worked out. |
| **Records** | A 🎉 note appears when baby has just had their longest sleep yet. |
| **Colour key** | Tap **?** under the bar to show or hide the legend. |
| **Night theme** | Dims automatically from 7pm to 7am. **Red-light mode** (12am–5am, on by default, switch off in Settings) turns the whole screen red, which is gentlest on dark-adapted eyes. |
| **Log tab** | Tap any entry to edit times, sides or places, or to delete it. **＋ Add** is for anything you missed. |
| **Insights** | *Trends* (7/14/30 days): line charts of longest stretch, night sleep, total sleep and feeds per day, with the best day marked. *Day*: totals, longest stretch, night vs day sleep (8pm–8am), naps, sleep places, feed count, average and longest gap (start→start), L/R balance, wake windows, nappies, notes. *7 / 14 / 30 days*: stacked Sims bars, highlight filter, daily averages, and a sortable by-day table. Tap a date to open that day. |
| **Export** | CSV for a day, a range, or everything, via the iPhone share sheet. |
| **Sync** | On open, after every tap, and every 30 s while open. Works offline and catches up later. The dot next to ⚙️ shows status: green = synced, amber = syncing, red = error, hollow = local only. |

## Updating the app later
Edit or re-upload files in the `baby-tracker` repo, and change `VERSION` in `sw.js` (e.g. `v1.0.1`) so phones fetch the new version. Close and reopen the app twice to pick it up.

## Privacy & safety
- The token is stored only on each phone, and it can only read and write `baby-data`.
- If a phone is lost: GitHub → Settings → Developer settings → Fine-grained tokens → **Revoke**, then create a new token and enter it again.
- The raw data is plain JSON in `baby-data/data/`, so you always own it.

## Troubleshooting
- **"Token rejected (401)"**: the token expired or was mistyped. Create a new one (step 3).
- **"Repo not found (404)"**: check the username and repo name, and that the token was given access to `baby-data`.
- **Data not appearing on the other phone**: tap the sync dot. Both phones must be using the same repo.
