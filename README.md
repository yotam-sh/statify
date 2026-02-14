# Spotify Stats Dashboard

A personal Spotify listening analytics dashboard built with Streamlit, powered by 12 years of extended streaming history (2014–2026) and the Spotify Web API.

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

To request your data: Spotify Settings → Privacy → Request your data → Extended streaming history.

### 4. Verify API connection

```bash
python test_connection.py
```

## Project Structure

```
spotify-tracker/
├── data/                   # Offline streaming history (JSON)
├── spotify_client.py       # Spotify API client wrapper (spotipy)
├── test_connection.py      # API connection & endpoint access test
├── .env                    # API credentials (gitignored)
├── .env.example            # Credential template
├── .gitignore
├── requirements.txt
└── README.md
```

## API Access

Uses the Spotify Web API via [spotipy](https://spotipy.readthedocs.io/). With basic quota, available endpoints include:

- Search (tracks, artists, albums)
- Track, artist, and album lookups (single)
- Artist discographies
- Album track listings

Restricted (basic quota): audio features, bulk lookups, recommendations, popularity scores.

## Data Sources

| Source | Coverage |
|---|---|
| Extended streaming history | Every play from 2014–2026 with timestamps, durations, skip/shuffle flags, platform, country |
| Spotify Web API | Album art, artist images, release dates, track durations |

## Credits

Built by Yotam with assistance from [Claude Code](https://claude.ai/claude-code) (Anthropic).
