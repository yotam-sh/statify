# Spotify Stats Dashboard

A multi-user Spotify listening analytics dashboard built with FastAPI and a single-page frontend. Upload your Spotify Extended Streaming History and explore 12+ years of listening data with rich visualizations, artist imagery, and user comparison tools.

## Features

### Tabs

- **Dashboard** - Total plays, hours, unique artists/tracks, monthly trend chart, top 5 artists and tracks with images
- **Top Artists** - Treemap with artist photos as tile backgrounds, ranked table with images, filterable by year and limit (25/50/100)
- **Top Albums** - Treemap grouped by artist with album cover art, ranked table, filterable by year and limit
- **Top Tracks** - Treemap grouped by album with album art, ranked table, filterable by year and limit
- **Timeline** - Yearly bar chart, interactive monthly heatmap with daily drill-down popups, taste evolution bump chart showing top 5 artists per year with rank lines and artist photos
- **Listening Habits** - Hour-of-day and day-of-week bar charts with Total/Average toggles, shuffle/skip stats, platform treemap
- **Artist Deep-Dive** - Search any artist for detailed stats, monthly timeline, top albums, and top tracks
- **Compare** - Side-by-side comparison of two users: shared artists/tracks, exclusive artists, and a 0–100 musical similarity score based on Jaccard overlap of top artists, tracks, and genres

### Auth & Multi-User

- **Invite-only accounts** — admin creates users via `create_user.py` CLI
- **JWT authentication** stored in HttpOnly cookies (7-day sessions)
- **Per-user data** — each user's streaming history stored separately; data never crosses between accounts
- **Per-user TTL cache** — DataFrames cached in memory for 10 minutes after last use, then evicted; server restarts clean
- **Public profiles** — each user's data is viewable at `/api/u/{username}/...`

### UX

- **Hours/Minutes toggle** — switch display units globally from the user menu
- **Year filter buttons** — multi-select year filtering on all tabs with "All Time" default
- **Upload via UI** — drag & drop or file picker; re-upload anytime to update data
- **Friendly upload errors** — validates zip structure, file naming, JSON schema, and Spotify column presence before accepting data
- **User menu** — username + gear icon opens dropdown with unit toggle, upload, and logout

### Image System

Artist photos and album covers are fetched from the Spotify Web API with a 6-layer fallback system, cached in SQLite so each lookup happens at most once. Images load asynchronously without blocking the UI.

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in your Spotify API credentials from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard), and set strong values for `JWT_SECRET` and `ADMIN_SECRET`.

### 3. Start the server

```bash
uvicorn app:app --reload
```

The server creates `data/users.db` and `data/users/` automatically on first run.

### 4. Create user accounts

```bash
python create_user.py add <username>    # prompts for password
python create_user.py list              # show all users
python create_user.py delete <username>
```

The `ADMIN_SECRET` in `.env` must match when creating users via the HTTP endpoint instead.

### 5. Upload streaming data

Log in at `http://localhost:8000`. On first login you'll see an upload screen — drag and drop your Spotify Extended Streaming History `.zip` file (the one containing `Streaming_History_Audio_*.json` files).

To request your data: Spotify → Settings → Privacy → Download your data → **Extended streaming history** (not the basic export).

### Docker

```bash
docker compose up --build
```

The container mounts `./data` for persistent storage.

## Project Structure

```
spotify-tracker/
├── app.py                  # FastAPI backend — auth, endpoints, analytics
├── index.html              # Single-page frontend (Tailwind CSS + Chart.js)
├── spotify_client.py       # Spotify API client wrapper (spotipy)
├── create_user.py          # Admin CLI for managing user accounts
├── data/
│   ├── users/
│   │   └── {user_id}/      # Per-user streaming history JSON files
│   ├── users.db            # User accounts (SQLite, auto-created)
│   └── image_cache.db      # Artist/album image cache (SQLite, auto-created)
├── Dockerfile
├── docker-compose.yml
├── .env                    # Credentials (gitignored)
├── .env.example
└── requirements.txt
```

## Tech Stack

- **Backend**: FastAPI, pandas, spotipy, python-jose, bcrypt, cachetools
- **Frontend**: Vanilla JS, Tailwind CSS (CDN), Chart.js v4, chartjs-chart-treemap
- **Storage**: SQLite (user accounts + image cache), per-user JSON files
- **Auth**: JWT in HttpOnly cookie, bcrypt password hashing
- **API**: Spotify Web API (Client Credentials flow for image/genre data)
- **Deployment**: Docker with volume-mounted data persistence

## Data Sources

| Source | Coverage |
|---|---|
| Extended streaming history | Every play with timestamps, durations, skip/shuffle flags, platform, country |
| Spotify Web API | Album art, artist images, artist genres, discographies |
