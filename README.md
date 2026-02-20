# Spotify Stats Dashboard

A personal Spotify listening analytics dashboard built with FastAPI and a single-page frontend, powered by 12 years of extended streaming history (2014-2026) and the Spotify Web API for artist/album imagery.

## Features

### Tabs

- **Dashboard** - Total plays, hours, unique artists/tracks, listening trend line chart, top 5 artists and tracks with progress bars and images
- **Top Artists** - Treemap chart with artist photos as tile backgrounds, ranked table with images, filterable by year and limit (25/50/100)
- **Top Albums** - Treemap chart grouped by artist with album cover art as tile backgrounds, dark banner group headers, ranked table with covers, filterable by year and limit
- **Top Tracks** - Treemap chart grouped by album with album art, dark banner group headers, ranked table, filterable by year and limit
- **Timeline** - Yearly hours bar chart, interactive monthly heatmap with daily drill-down popups, taste evolution bump chart showing top 5 artists per year with circular artist photos and rank lines
- **Listening Habits** - Hour-of-day and day-of-week bar charts with Total/Average toggles, shuffle/skip percentage stats, platform treemap
- **Artist Deep-Dive** - Search any artist for detailed stats, monthly listening timeline, top 5 album covers, and top tracks table

### UX Features

- **Hours/Minutes toggle** - Switch between hours and minutes display globally from the navbar
- **Year filter buttons** - Multi-select year filtering on all tabs, with "All Time" default and clear button
- **Crosshair plugin** - Crosshair guides on chart hover for precise reading
- **Loading states** - Spinner overlay on tab refresh, loading indicators on first visit
- **Treemap image tiles** - Artist photos and album covers fill treemap tiles in cover mode with dark overlay for text readability; grouped treemaps show dark banner headers with dynamic font sizing
- **Treemap tooltips** - Artist photos shown in Top Albums and Top Tracks tooltips; leaf-level targeting via `el.inRange()` for accurate hover detection
- **Bump chart** - Taste evolution shown as rank lines (1-5) with circular artist photos at data points; solid lines for consecutive years, dashed lines when an artist drops out and returns
- **Heatmap drill-down** - Click any monthly heatmap cell to see a daily breakdown popup with per-day listening hours

### Image System

Artist photos and album covers are fetched from the Spotify Web API with a 6-layer fallback system to maximize cover art discovery:

1. Strict album search (`album:{name} artist:{artist}`)
2. Loose album search (`{album} {artist}`, filtered by artist)
3. Stripped suffixes - removes `(Deluxe Edition)`, `[Remastered]`, etc. and retries
4. Track-based search - searches as a track and extracts album art from the result
5. Artist discography browse - fetches full discography and fuzzy-matches album names
6. Artist image fallback - uses the artist's photo when no album art is found

All results are cached in a local SQLite database (`data/image_cache.db`) so each lookup happens at most once. Pages load instantly with cached images; uncached images are resolved asynchronously in the background without blocking the UI. Rate-limited requests (429) break early to avoid cascading failures, and empty cache entries are automatically retried when the API becomes available.

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure Spotify API credentials

Copy the example env file and fill in your credentials from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):

```bash
cp .env.example .env
```

Edit `.env` with your Client ID and Client Secret.

### 3. Add your streaming data

Place your Spotify extended streaming history JSON files in `data/<YourName>/`.

To request your data: Spotify Settings > Privacy > Request your data > Extended streaming history.

### 4. Run the dashboard

```bash
python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

Open http://localhost:8000 in your browser.

### Docker

```bash
docker compose up --build
```

The container mounts `./data` for persistent image cache and streaming history.

## Project Structure

```
spotify-tracker/
├── app.py                  # FastAPI backend with all API endpoints
├── index.html              # Single-page frontend (Tailwind CSS + Chart.js)
├── spotify_client.py       # Spotify API client wrapper (spotipy)
├── data/
│   ├── <YourName>/         # Extended streaming history JSON files
│   └── image_cache.db      # SQLite cache for artist/album images (auto-created)
├── test_connection.py      # API connection & endpoint access test
├── Dockerfile              # Container image definition
├── docker-compose.yml      # Docker Compose service config
├── .dockerignore           # Docker build exclusions
├── .env                    # API credentials (gitignored)
├── .env.example            # Credential template
├── requirements.txt
└── README.md
```

## Tech Stack

- **Backend**: FastAPI, pandas, spotipy
- **Frontend**: Vanilla JS, Tailwind CSS (CDN), Chart.js v4, chartjs-chart-treemap
- **Image Cache**: SQLite with async background resolution
- **API**: Spotify Web API (Client Credentials flow, no user login needed)
- **Deployment**: Docker with volume-mounted data persistence

## Data Sources

| Source | Coverage |
|---|---|
| Extended streaming history | Every play from 2014-2026 with timestamps, durations, skip/shuffle flags, platform, country |
| Spotify Web API | Album art, artist images, artist discographies |

## Credits

Built by Yotam with assistance from [Claude Code](https://claude.ai/claude-code) (Anthropic).
