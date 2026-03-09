# Statify

A multi-user Spotify listening analytics dashboard built with FastAPI and a Vite-powered single-page frontend. Upload your Spotify Extended Streaming History and explore years of listening data with rich visualizations, artist imagery, and user comparison tools.

## Features

### Tabs

- **Dashboard** - Total plays, hours, unique artists/tracks, monthly trend chart (with optional gap-year zero-fill), top 5 artists and tracks with images
- **Top Artists** - Treemap with artist photos as tile backgrounds, ranked table with images and clickable Spotify links, filterable by year and limit (25/50/100)
- **Top Albums** - Treemap grouped by artist with album cover art, ranked table with clickable Spotify links, filterable by year and limit
- **Top Tracks** - Treemap grouped by album with album art, ranked table with clickable Spotify links, filterable by year and limit
- **Timeline** - Yearly bar chart, interactive monthly heatmap with daily drill-down popups, taste evolution bump chart showing top 5 artists per year with rank lines and artist photos; gap years shown as empty bars/rows when the Empty Years toggle is on
- **Listening Habits** - Hour-of-day and day-of-week bar charts with Total/Average toggles, shuffle/skip stats, platform treemap
- **Artist Deep-Dive** - Search any artist for detailed stats, monthly timeline, top albums, and top tracks
- **Compare** - Multi-user comparison (self vs up to 4 others) in a tabular layout: 0–100 musical similarity gauge per user, shared artists and tracks (searched across full listening history), exclusive artists and tracks, artist overlap donut (% of top 100 shared), hour-of-day listening pattern lines, and skip rate bars

### Auth & Multi-User

- **Invite-only accounts** - admin creates users via `create_user.py` CLI
- **JWT authentication** stored in HttpOnly cookies (7-day sessions)
- **Per-user data** - each user's streaming history stored separately; data never crosses between accounts
- **Per-user TTL cache** - DataFrames cached in memory for 10 minutes after last use, then evicted; server restarts clean
- **Public profiles** - each user's data is viewable at `/api/u/{username}/...`
- **In-app Admin panel** - admin user can:
  - View system overview: user count, cached image/genre counts, Spotify API configuration status plus live request availability (including retry-after time when rate-limited); empty image counts are clickable and jump directly to a filtered image cache view; "Backfill Spotify IDs" button to populate deep-links for existing cache entries
  - Manage users in a sortable, filterable table with data size (MB), last data date, and file count columns; actions include toggle public/private, view data, reset password, clear streaming data (keeps account), and delete account
  - Browse and edit the image cache with the "Fix an Image" search panel side-by-side with the table; search Spotify by name or Spotify ID, pick a replacement image, and save it; bulk-refresh all empty entries; rate-limit aware ("API unavailable — try again in ~Xm" when blocked)
  - Impersonate any user to browse their data — year filter bar and all tabs reset instantly and preload in the background on every user switch

### UX

- **Hours/Minutes toggle** - switch display units globally from the user menu
- **Profile visibility toggle** - users can set their own profile to Public or Private from the user menu
- **Empty years toggle** - user menu switch to show or hide gap years (years within your data range with no plays) across the Dashboard trend chart, Timeline yearly bars, monthly heatmap, and taste evolution chart; gap years in the filter bar are always shown as disabled (greyed-out) buttons
- **Shared year filter** - single persistent filter bar above all data tabs; selecting years on any tab applies to all; switching tabs after a filter change is instant (other tabs preload silently in the background); year buttons cover the full continuous range from your earliest to latest data — gap years appear disabled rather than missing
- **Spotify deep-links** - artist, album, and track names in the three top-N tables link directly to their Spotify pages; track links work immediately (URI stored in streaming history); artist and album links are populated automatically on startup and every 6 hours via a background Spotify ID backfill (rate-limit aware)
- **Upload via UI** - drag & drop or file picker; re-upload anytime to update data
- **Friendly upload errors** - validates zip structure, file naming, JSON schema, and Spotify column presence before accepting data
- **User menu** - username + gear icon opens dropdown with unit toggle, visibility toggle, empty years toggle, upload, and logout
- **Sticky table headers** - column headers stay visible while scrolling through long tables; columns are fixed-width with wrapping cell text
- **Mobile-responsive** - charts adapt to portrait/landscape viewports; tab bar scrolls on small screens
- **Login page mosaic** - animated 3-column scrolling mosaic of background images on the login screen; drop images into `asset/login_backgrounds/` to include them automatically

### Image System

Artist photos and album covers are fetched from the Spotify Web API with a 6-layer fallback system, cached in SQLite so each lookup happens at most once. Images load asynchronously without blocking the UI. Spotify IDs for deep-linking are stored alongside image URLs and backfilled automatically on server startup (and every 6 hours thereafter) for any entries added before the feature was enabled.

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Install frontend dependencies and build

```bash
npm install
npm run build
```

### 3. Configure environment

```bash
cp .env.example .env
```

Fill in your Spotify API credentials from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), and set strong values for `JWT_SECRET` and `ADMIN_SECRET`. Set `ADMIN_USERNAME` to the username(s) that should have admin access — comma-separated for multiple admins (e.g. `alice,bob`). Leave blank to disable the admin panel.

### 4. Start the server

```bash
uvicorn app:app --reload
```

The server creates `data/users.db` and `data/users/` automatically on first run and serves the built frontend from `dist/`.

For development with hot-reload on the frontend, run both in parallel:

```bash
npm run dev          # Vite dev server on :5173 (proxies /api to :8000)
uvicorn app:app --reload --port 8000
```

### 5. Create user accounts

```bash
python create_user.py add <username>    # prompts for password
python create_user.py list              # show all users
python create_user.py delete <username>
```

The `ADMIN_SECRET` in `.env` must match when creating users via the HTTP endpoint instead.

### 6. Upload streaming data

Log in at `http://localhost:8000`. On first login you'll see an upload screen - drag and drop your Spotify Extended Streaming History `.zip` file (the one containing `Streaming_History_Audio_*.json` files).

To request your data: Spotify > Settings > Privacy > Download your data > **Extended streaming history** (not the basic export).

### Docker

```bash
docker compose up --build
```

Set `CADDY_HOST` in your environment to your domain and Caddy will handle TLS automatically. The container mounts `./data` for persistent storage.

## Project Structure

```
statify/
├── app.py                  # FastAPI backend - auth, endpoints, analytics
├── spotify_client.py       # Spotify API client wrapper (spotipy)
├── create_user.py          # Admin CLI for managing user accounts
├── index.html              # SPA entry point
├── src/
│   ├── app.js              # Frontend ES module (Chart.js, all UI logic)
│   └── styles.css          # Tailwind directives + custom CSS
├── asset/
│   ├── logo.svg            # App icon (favicon)
│   ├── logo_with_name.svg  # Full logo used in navbar, login, and splash
│   └── login_backgrounds/  # Images for the login page mosaic (auto-discovered)
├── tests/
│   └── responsive.spec.js  # Playwright responsive layout tests
├── data/
│   ├── users/
│   │   └── {user_id}/      # Per-user streaming history JSON files
│   ├── users.db            # User accounts (SQLite, auto-created)
│   └── image_cache.db      # Artist/album image cache (SQLite, auto-created)
├── dist/                   # Built frontend output (gitignored)
├── Dockerfile
├── docker-compose.yml
├── Caddyfile
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── playwright.config.js
├── .env                    # Credentials (gitignored)
├── .env.example
└── requirements.txt
```

## Tech Stack

- **Backend**: FastAPI, pandas, spotipy, python-jose, bcrypt, cachetools, slowapi
- **Frontend**: ES module (Vite), Tailwind CSS v3, Chart.js v4, chartjs-chart-treemap
- **Storage**: SQLite (user accounts + image cache), per-user JSON files
- **Auth**: JWT in HttpOnly cookie, bcrypt password hashing, rate-limited login endpoint
- **API**: Spotify Web API (Client Credentials flow for image/genre data)
- **Deployment**: Docker multi-stage build, Caddy reverse proxy with automatic TLS
- **Testing**: Playwright across 6 viewport profiles (portrait/landscape phone, tablet, desktop)

## Data Sources

| Source | Coverage |
|---|---|
| Extended streaming history | Every play with timestamps, durations, skip/shuffle flags, platform, country |
| Spotify Web API | Album art, artist images, artist genres, discographies |

## Credits

- Vibe coding, idea, fighting with Claude by [yotam-sh]
- Code by [Anthropic's Claude](https://claude.ai) (Claude Code)
- Logo by [OpenAI's ChatGPT](https://chatgpt.com)

## License

[MIT](LICENSE)