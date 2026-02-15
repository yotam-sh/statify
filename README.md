# Spotify Stats Dashboard

A personal Spotify listening analytics dashboard built with FastAPI and a single-page frontend, powered by 12 years of extended streaming history (2014-2026) and the Spotify Web API for artist/album imagery.

## Features

- **Dashboard** - Total plays, hours, unique artists/tracks, listening trend over time, top 5 artists and tracks with images
- **Top Artists** - Ranked table and horizontal bar chart with artist photos, filterable by year and limit
- **Top Tracks** - Ranked table and chart with album cover art
- **Timeline** - Yearly hours bar chart, monthly heatmap, taste evolution (top 5 artists per year)
- **Listening Habits** - Hour-of-day and day-of-week patterns, shuffle/skip/platform breakdowns
- **Artist Deep-Dive** - Search any artist for detailed stats, listening timeline, top albums with cover art, and top tracks

### Image System

Artist photos and album covers are fetched from the Spotify Web API with a 6-layer fallback system to maximize cover art discovery:

1. Strict album search (`album:{name} artist:{artist}`)
2. Loose album search (`{album} {artist}`, filtered by artist)
3. Stripped suffixes - removes `(Deluxe Edition)`, `[Remastered]`, etc. and retries
4. Track-based search - searches as a track and extracts album art from the result
5. Artist discography browse - fetches full discography and fuzzy-matches album names
6. Artist image fallback - uses the artist's photo when no album art is found

All results are cached in a local SQLite database (`data/image_cache.db`) so each lookup happens at most once. Pages load instantly with cached images; uncached images are resolved asynchronously in the background without blocking the UI.

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
├── .env                    # API credentials (gitignored)
├── .env.example            # Credential template
├── requirements.txt
└── README.md
```

## Tech Stack

- **Backend**: FastAPI, pandas, spotipy
- **Frontend**: Vanilla JS, Tailwind CSS (CDN), Chart.js v4
- **Image Cache**: SQLite with async background resolution
- **API**: Spotify Web API (Client Credentials flow, no user login needed)

## Data Sources

| Source | Coverage |
|---|---|
| Extended streaming history | Every play from 2014-2026 with timestamps, durations, skip/shuffle flags, platform, country |
| Spotify Web API | Album art, artist images, artist discographies |

## Credits

Built by Yotam with assistance from [Claude Code](https://claude.ai/claude-code) (Anthropic).
