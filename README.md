# Statify

A multi-user Spotify listening analytics dashboard built with FastAPI and a Vite-powered single-page frontend. Upload your Spotify Extended Streaming History and explore years of listening data with rich visualizations, artist imagery, and user comparison tools.

## Features

### Tabs

- **Dashboard** - Total plays, hours, unique artists/tracks, monthly trend chart, top 5 artists and tracks with images
- **Top Artists** - Treemap with artist photos as tile backgrounds, ranked table with images, filterable by year and limit (25/50/100)
- **Top Albums** - Treemap grouped by artist with album cover art, ranked table, filterable by year and limit
- **Top Tracks** - Treemap grouped by album with album art, ranked table, filterable by year and limit
- **Timeline** - Yearly bar chart, interactive monthly heatmap with daily drill-down popups, taste evolution bump chart showing top 5 artists per year with rank lines and artist photos
- **Listening Habits** - Hour-of-day and day-of-week bar charts with Total/Average toggles, shuffle/skip stats, platform treemap
- **Artist Deep-Dive** - Search any artist for detailed stats, monthly timeline, top albums, and top tracks
- **Compare** - Side-by-side comparison of two users: shared artists/tracks, exclusive artists, and a 0-100 musical similarity score based on Jaccard overlap of top artists, tracks, and genres

### Auth & Multi-User

- **Invite-only accounts** - admin creates users via `create_user.py` CLI
- **JWT authentication** stored in HttpOnly cookies (7-day sessions)
- **Per-user data** - each user's streaming history stored separately; data never crosses between accounts
- **Per-user TTL cache** - DataFrames cached in memory for 10 minutes after last use, then evicted; server restarts clean
- **Public profiles** - each user's data is viewable at `/api/u/{username}/...`
- **In-app Admin panel** - admin user can view system overview stats, manage users (toggle public flag, reset password, delete), impersonate any user to browse their data, browse and edit the image cache, search Spotify for replacement images, and bulk-refresh empty image entries

### UX

- **Hours/Minutes toggle** - switch display units globally from the user menu
- **Shared year filter** - single persistent filter bar above all data tabs; selecting years on any tab applies to all; switching tabs after a filter change is instant (other tabs preload silently in the background)
- **Upload via UI** - drag & drop or file picker; re-upload anytime to update data
- **Friendly upload errors** - validates zip structure, file naming, JSON schema, and Spotify column presence before accepting data
- **User menu** - username + gear icon opens dropdown with unit toggle, upload, and logout
- **Mobile-responsive** - charts adapt to portrait/landscape viewports; tab bar scrolls on small screens
- **Login page mosaic** - animated 3-column scrolling mosaic of background images on the login screen; drop images into `asset/login_backgrounds/` to include them automatically

### Image System

Artist photos and album covers are fetched from the Spotify Web API with a 6-layer fallback system, cached in SQLite so each lookup happens at most once. Images load asynchronously without blocking the UI.

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