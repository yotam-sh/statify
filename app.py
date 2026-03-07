"""Statify – FastAPI backend.

Loads extended streaming history JSON files, pre-computes aggregations,
and serves data through API endpoints consumed by a single-page frontend.
Fetches artist/album images from Spotify API with SQLite caching.
Supports multiple users with JWT authentication and per-user TTL cache.
"""

from __future__ import annotations

import difflib
import glob as globmod
from itertools import combinations
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import calendar
import time
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Optional

import pandas as pd
from cachetools import TTLCache
from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from jose import JWTError, jwt
import bcrypt as _bcrypt_lib

from spotify_client import get_client_credentials_client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

_BASE = os.path.dirname(__file__)
DB_PATH      = os.path.join(_BASE, "data", "image_cache.db")
USERS_DB     = os.path.join(_BASE, "data", "users.db")
USERS_DIR    = os.path.join(_BASE, "data", "users")

JWT_SECRET    = os.getenv("JWT_SECRET", "")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7
ADMIN_SECRET  = os.getenv("ADMIN_SECRET", "")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "")  # comma-separated for multiple admins
_ADMIN_USERNAMES: set[str] = {u.strip() for u in ADMIN_USERNAME.split(",") if u.strip()}
_SECURE_COOKIES = os.getenv("SECURE_COOKIES", "false").lower() == "true"
_SPOTIFY_ID_RE = re.compile(r'^[0-9A-Za-z]{22}$')

_MISSING_SECRETS: list[str] = []
if not JWT_SECRET:
    _MISSING_SECRETS.append("JWT_SECRET")
if not ADMIN_SECRET:
    _MISSING_SECRETS.append("ADMIN_SECRET")
if _MISSING_SECRETS:
    import sys
    print(
        f"FATAL: required environment variable(s) not set: {', '.join(_MISSING_SECRETS)}\n"
        "Set them in a .env file or as environment variables before starting the server.",
        file=sys.stderr,
    )
    sys.exit(1)

# Per-user TTL cache: keeps DataFrames + precomputed caches for 10 min of inactivity
_user_cache: TTLCache = TTLCache(maxsize=50, ttl=600)
_user_locks: dict[str, Lock] = {}
_user_locks_mutex = Lock()

# Per-key in-process locks — prevent duplicate Spotify API calls for the same artist/album
_artist_img_locks: dict[str, Lock] = {}
_album_img_locks:  dict[str, Lock] = {}
_genre_locks:      dict[str, Lock] = {}
_fetch_locks_mutex = Lock()


def _get_fetch_lock(lock_dict: dict[str, Lock], key: str) -> Lock:
    with _fetch_locks_mutex:
        if key not in lock_dict:
            lock_dict[key] = Lock()
        return lock_dict[key]


# ---------------------------------------------------------------------------
# Data loading & pre-computation
# ---------------------------------------------------------------------------

def _load_dataframe(data_dir: str) -> pd.DataFrame | None:
    """Load all audio streaming history JSON files from data_dir into one DataFrame.
    Returns None if no files are found."""
    files = sorted(globmod.glob(os.path.join(data_dir, "Streaming_History_Audio_*.json")))
    if not files:
        return None

    dfs = []
    for f in files:
        try:
            dfs.append(pd.read_json(f))
        except ValueError as e:
            raise ValueError(f"Could not parse {os.path.basename(f)}: {e}") from e

    df = pd.concat(dfs, ignore_index=True)

    required = {"ts", "master_metadata_track_name", "ms_played"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(
            "These files don't look like Spotify Extended Streaming History "
            f"(missing columns: {', '.join(sorted(missing))}). "
            "Make sure you request 'Extended streaming history', not the basic export."
        )

    # Drop rows without a track name (podcasts / null entries)
    df = df.dropna(subset=["master_metadata_track_name"])

    # Shorter column aliases
    df.rename(columns={
        "master_metadata_track_name": "track",
        "master_metadata_album_artist_name": "artist",
        "master_metadata_album_album_name": "album",
    }, inplace=True)

    # Derived columns
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df["hours"] = df["ms_played"] / 3_600_000
    df["year"] = df["ts"].dt.year
    df["month"] = df["ts"].dt.month
    df["year_month"] = df["ts"].dt.strftime("%Y-%m")
    df["hour"] = df["ts"].dt.hour
    df["day_of_week"] = df["ts"].dt.day_name()

    return df


def _user_data_dir(user_id: str) -> str:
    return os.path.join(USERS_DIR, user_id)


def _get_user_lock(user_id: str) -> Lock:
    with _user_locks_mutex:
        if user_id not in _user_locks:
            _user_locks[user_id] = Lock()
        return _user_locks[user_id]


def _get_user_data(user_id: str) -> dict | None:
    """Return cached {df, cache} for user_id, loading from disk on cache miss."""
    if user_id in _user_cache:
        return _user_cache[user_id]

    lock = _get_user_lock(user_id)
    with lock:
        # Double-check after acquiring lock
        if user_id in _user_cache:
            return _user_cache[user_id]

        df = _load_dataframe(_user_data_dir(user_id))
        if df is None:
            return None

        entry = {"df": df, "cache": _precompute(df)}
        _user_cache[user_id] = entry
        print(f"Loaded {len(df):,} records for user {user_id}.")
        return entry


def _invalidate_user_cache(user_id: str) -> None:
    _user_cache.pop(user_id, None)


# ---------------------------------------------------------------------------
# Users DB
# ---------------------------------------------------------------------------

def _init_users_db() -> None:
    os.makedirs(os.path.dirname(USERS_DB), exist_ok=True)
    conn = sqlite3.connect(USERS_DB)
    conn.execute("""CREATE TABLE IF NOT EXISTS users (
        user_id       TEXT PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        is_public     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL
    )""")
    conn.commit()
    conn.close()


def _get_users_db():
    return sqlite3.connect(USERS_DB)


def _db_get_user_by_username(username: str) -> dict | None:
    conn = _get_users_db()
    row = conn.execute(
        "SELECT user_id, username, password_hash, is_public FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"user_id": row[0], "username": row[1], "password_hash": row[2], "is_public": bool(row[3])}


def _db_get_user_by_id(user_id: str) -> dict | None:
    conn = _get_users_db()
    row = conn.execute(
        "SELECT user_id, username, is_public FROM users WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"user_id": row[0], "username": row[1], "is_public": bool(row[2])}


def _db_create_user(username: str, password: str) -> dict:
    user_id = str(uuid.uuid4())
    password_hash = _bcrypt_lib.hashpw(password.encode(), _bcrypt_lib.gensalt()).decode()
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_users_db()
    conn.execute(
        "INSERT INTO users (user_id, username, password_hash, is_public, created_at) VALUES (?,?,?,1,?)",
        (user_id, username, password_hash, now),
    )
    conn.commit()
    conn.close()
    return {"user_id": user_id, "username": username}


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def _create_token(user_id: str, username: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRE_DAYS)
    payload: dict = {"sub": user_id, "username": username, "exp": exp}
    if username in _ADMIN_USERNAMES:
        payload["is_admin"] = True
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


# FastAPI dependencies
async def get_current_user(auth_token: Optional[str] = Cookie(None)) -> dict:
    if not auth_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        return _decode_token(auth_token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


async def get_optional_user(auth_token: Optional[str] = Cookie(None)) -> dict | None:
    if not auth_token:
        return None
    try:
        return _decode_token(auth_token)
    except JWTError:
        return None


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin only")
    return user


# ---------------------------------------------------------------------------
# Image cache (SQLite + Spotify API)
# ---------------------------------------------------------------------------

def _init_image_db():
    """Create the image cache database and tables if they don't exist."""
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS artist_images (
        artist_name TEXT PRIMARY KEY,
        image_url TEXT,
        fetched_at TEXT
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS album_images (
        album_name TEXT,
        artist_name TEXT,
        image_url TEXT,
        fetched_at TEXT,
        PRIMARY KEY (album_name, artist_name)
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS artist_genres (
        artist_name TEXT PRIMARY KEY,
        genres TEXT,
        fetched_at TEXT
    )""")
    conn.commit()
    conn.close()


def _get_db():
    return sqlite3.connect(DB_PATH)


def _get_artist_images_batch(names: list[str], cached_only: bool = False) -> dict[str, str]:
    """Look up artist images: DB first, API for misses (unless cached_only), cache results."""
    if not names:
        return {}

    conn = _get_db()
    placeholders = ",".join("?" for _ in names)
    rows = conn.execute(
        f"SELECT artist_name, image_url FROM artist_images WHERE artist_name IN ({placeholders})",
        names,
    ).fetchall()
    cached = {r[0]: r[1] for r in rows}

    misses = [n for n in names if not cached.get(n)]
    if misses and not cached_only:
        sp = get_client_credentials_client()
        now = datetime.now(timezone.utc).isoformat()
        rate_limited = False
        for name in misses:
            if rate_limited:
                break
            lock = _get_fetch_lock(_artist_img_locks, name.lower())
            with lock:
                # Double-check: another thread may have populated the DB while we waited
                row = conn.execute(
                    "SELECT image_url FROM artist_images WHERE artist_name = ?", (name,)
                ).fetchone()
                if row is not None:
                    cached[name] = row[0]
                    continue
                url = ""
                try:
                    results = sp.search(q=f"artist:{name}", type="artist", limit=5)
                    items = results.get("artists", {}).get("items", [])
                    # Prefer exact name match (case-insensitive) over first result
                    match = None
                    for item in items:
                        if item["name"].lower() == name.lower():
                            match = item
                            break
                    if not match and items:
                        match = items[0]
                    if match and match.get("images"):
                        # Use 320px image (index 1) if available, else first
                        images = match["images"]
                        url = images[1]["url"] if len(images) > 1 else images[0]["url"]
                except Exception as e:
                    if '429' in str(e) or 'rate' in str(e).lower():
                        rate_limited = True
                cached[name] = url
                conn.execute(
                    "INSERT OR REPLACE INTO artist_images (artist_name, image_url, fetched_at) VALUES (?, ?, ?)",
                    (name, url, now),
                )
                conn.commit()
                time.sleep(0.05)  # Rate limiting

    conn.close()
    return {n: cached.get(n, "") for n in names}


def _strip_album_suffix(name: str) -> str:
    """Remove common suffixes like (Deluxe Edition), [Remastered 2021], etc."""
    cleaned = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", name).strip()
    return cleaned if cleaned else name


def _extract_album_img(items: list) -> str:
    """Extract the best image URL from Spotify album/track items."""
    if not items:
        return ""
    images = items[0].get("images") or items[0].get("album", {}).get("images", [])
    if not images:
        return ""
    return images[1]["url"] if len(images) > 1 else images[0]["url"]


def _artist_matches(items: list, artist: str) -> list:
    """Filter items to those matching the given artist name (case-insensitive)."""
    artist_lower = artist.lower()
    return [
        it for it in items
        if any(artist_lower in a["name"].lower() for a in it.get("artists", []))
    ]


def _search_album_cover(sp, album: str, artist: str) -> str:
    """Multi-strategy search for an album cover. Returns URL or empty string.

    Fallback chain:
    1. Strict: album:{album} artist:{artist}
    2. Loose: {album} {artist} (filtered by artist)
    3. Stripped: remove suffixes like (Deluxe), [Remastered], retry 1+2
    4. Track-based: search {album} {artist} as track, get album art from result
    5. Artist discography: browse artist's albums, fuzzy match name
    """
    # --- Strategy 1: Strict album search ---
    results = sp.search(q=f"album:{album} artist:{artist}", type="album", limit=1)
    items = results.get("albums", {}).get("items", [])
    url = _extract_album_img(items)
    if url:
        return url

    # --- Strategy 2: Loose album search ---
    results = sp.search(q=f"{album} {artist}", type="album", limit=5)
    matched = _artist_matches(results.get("albums", {}).get("items", []), artist)
    url = _extract_album_img(matched)
    if url:
        return url

    # --- Strategy 3: Strip suffixes and retry ---
    stripped = _strip_album_suffix(album)
    if stripped != album:
        results = sp.search(q=f"album:{stripped} artist:{artist}", type="album", limit=1)
        url = _extract_album_img(results.get("albums", {}).get("items", []))
        if url:
            return url
        results = sp.search(q=f"{stripped} {artist}", type="album", limit=5)
        matched = _artist_matches(results.get("albums", {}).get("items", []), artist)
        url = _extract_album_img(matched)
        if url:
            return url

    # --- Strategy 4: Track-based search (most reliable for compilations) ---
    results = sp.search(q=f"{album} artist:{artist}", type="track", limit=5)
    track_items = _artist_matches(results.get("tracks", {}).get("items", []), artist)
    if track_items:
        track_album = track_items[0].get("album", {})
        images = track_album.get("images", [])
        if images:
            return images[1]["url"] if len(images) > 1 else images[0]["url"]

    # --- Strategy 5: Artist discography browse + fuzzy match ---
    try:
        artist_results = sp.search(q=f"artist:{artist}", type="artist", limit=1)
        artist_items = artist_results.get("artists", {}).get("items", [])
        if artist_items:
            artist_id = artist_items[0]["id"]
            disc_items = []
            url = f"artists/{artist_id}/albums"
            while url and len(disc_items) < 100:
                page = sp._get(url)
                disc_items.extend(page.get("items", []))
                url = page.get("next")
                if url:
                    import requests as _req
                    headers = {"Authorization": f"Bearer {sp.auth_manager.get_access_token(as_dict=False)}"}
                    r = _req.get(url, headers=headers)
                    if r.status_code == 200:
                        page = r.json()
                        disc_items.extend(page.get("items", []))
                        url = page.get("next")
                    else:
                        break

            album_lower = album.lower()
            stripped_lower = stripped.lower()

            for disc_album in disc_items:
                disc_name = disc_album["name"].lower()
                disc_stripped = _strip_album_suffix(disc_name)
                if (album_lower in disc_name or disc_name in album_lower
                        or stripped_lower in disc_stripped or disc_stripped in stripped_lower):
                    images = disc_album.get("images", [])
                    if images:
                        return images[1]["url"] if len(images) > 1 else images[0]["url"]

            best_score, best_img = 0.0, ""
            album_tokens = set(re.split(r'\W+', album_lower)) - {"", "the", "a", "an", "of"}
            for disc_album in disc_items:
                disc_name = disc_album["name"].lower()
                disc_tokens = set(re.split(r'\W+', disc_name)) - {"", "the", "a", "an", "of"}
                if album_tokens and disc_tokens:
                    overlap = len(album_tokens & disc_tokens) / min(len(album_tokens), len(disc_tokens))
                else:
                    overlap = 0
                seq = difflib.SequenceMatcher(None, album_lower, disc_name).ratio()
                score = max(overlap, seq)
                if score > best_score:
                    images = disc_album.get("images", [])
                    if images:
                        best_score = score
                        best_img = images[1]["url"] if len(images) > 1 else images[0]["url"]
            if best_score >= 0.4:
                return best_img
    except Exception:
        pass

    return ""


def _get_album_images_batch(albums: list[tuple[str, str]], cached_only: bool = False) -> dict[tuple[str, str], str]:
    """Look up album images: DB first, API for misses (unless cached_only)."""
    if not albums:
        return {}

    conn = _get_db()
    cached: dict[tuple[str, str], str] = {}
    for album, artist in albums:
        row = conn.execute(
            "SELECT image_url FROM album_images WHERE album_name = ? AND artist_name = ?",
            (album, artist),
        ).fetchone()
        if row is not None:
            cached[(album, artist)] = row[0]

    misses = [a for a in albums if not cached.get(a)]
    if misses and not cached_only:
        sp = get_client_credentials_client()
        now = datetime.now(timezone.utc).isoformat()

        miss_artists = list({artist for _, artist in misses})
        artist_imgs = _get_artist_images_batch(miss_artists, cached_only=True)

        rate_limited = False
        for album, artist in misses:
            if rate_limited:
                break
            lock_key = f"{album}||{artist}"
            lock = _get_fetch_lock(_album_img_locks, lock_key)
            with lock:
                # Double-check: another thread may have populated the DB while we waited
                row = conn.execute(
                    "SELECT image_url FROM album_images WHERE album_name = ? AND artist_name = ?",
                    (album, artist),
                ).fetchone()
                if row is not None:
                    cached[(album, artist)] = row[0]
                    continue
                url = ""
                try:
                    url = _search_album_cover(sp, album, artist)
                except Exception as e:
                    if '429' in str(e) or 'rate' in str(e).lower():
                        rate_limited = True

                if not url:
                    url = artist_imgs.get(artist, "")

                cached[(album, artist)] = url
                conn.execute(
                    "INSERT OR REPLACE INTO album_images (album_name, artist_name, image_url, fetched_at) VALUES (?, ?, ?, ?)",
                    (album, artist, url, now),
                )
                conn.commit()
                time.sleep(0.05)

    conn.close()
    return {a: cached.get(a, "") for a in albums}


# ---------------------------------------------------------------------------
# Genre cache
# ---------------------------------------------------------------------------

def _get_artist_genres_batch(names: list[str], cached_only: bool = False) -> dict[str, str]:
    """Look up artist genres: DB first, API for misses. Returns {artist: primary_genre}."""
    if not names:
        return {}
    conn = _get_db()
    cached: dict[str, str] = {}
    for name in names:
        row = conn.execute("SELECT genres FROM artist_genres WHERE artist_name = ?", (name,)).fetchone()
        if row is not None:
            cached[name] = row[0]

    misses = [n for n in names if n not in cached]
    if misses and not cached_only:
        sp = get_client_credentials_client()
        now = datetime.now(timezone.utc).isoformat()
        for name in misses:
            lock = _get_fetch_lock(_genre_locks, name.lower())
            with lock:
                # Double-check: another thread may have populated the DB while we waited
                row = conn.execute(
                    "SELECT genres FROM artist_genres WHERE artist_name = ?", (name,)
                ).fetchone()
                if row is not None:
                    cached[name] = row[0]
                    continue
                try:
                    results = sp.search(q=f"artist:{name}", type="artist", limit=1)
                    items = results.get("artists", {}).get("items", [])
                    genres = items[0].get("genres", []) if items else []
                    genre_str = genres[0].title() if genres else "Other"
                    cached[name] = genre_str
                    conn.execute(
                        "INSERT OR REPLACE INTO artist_genres (artist_name, genres, fetched_at) VALUES (?, ?, ?)",
                        (name, genre_str, now),
                    )
                except Exception:
                    cached[name] = "Other"
                    conn.execute(
                        "INSERT OR REPLACE INTO artist_genres (artist_name, genres, fetched_at) VALUES (?, ?, ?)",
                        (name, "Other", now),
                    )
                conn.commit()
    conn.close()
    return cached


# ---------------------------------------------------------------------------
# Helpers (non-image)
# ---------------------------------------------------------------------------

def _simplify_platform(p: str) -> str:
    p = str(p).lower()
    if "android" in p:
        return "Android"
    if "windows" in p or "win" in p:
        return "Windows"
    if "ios" in p or "iphone" in p or "ipad" in p:
        return "iOS"
    if "web" in p:
        return "Web Player"
    if "cast" in p or "tv" in p or "tizen" in p or "webos" in p:
        return "Smart TV / Cast"
    return "Other"


def _bool_counts(df: pd.DataFrame, col: str) -> dict:
    counts = df[col].value_counts()
    return {
        "labels": ["Yes" if k else "No" for k in counts.index],
        "values": [int(v) for v in counts.values],
    }


def _compute_habits(df: pd.DataFrame) -> dict:
    """Compute all habit metrics from a (possibly filtered) DataFrame."""
    dow_order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

    hourly = df.groupby("hour")["hours"].sum().reindex(range(24), fill_value=0).round(1)
    hourly_dates = df.groupby("hour")["ts"].apply(lambda x: x.dt.date.nunique()).reindex(range(24), fill_value=1)
    hourly_avg = (hourly / hourly_dates).round(2)

    dow = df.groupby("day_of_week")["hours"].sum().reindex(dow_order, fill_value=0).round(1)
    dow_dates = df.groupby("day_of_week")["ts"].apply(lambda x: x.dt.date.nunique()).reindex(dow_order, fill_value=1)
    dow_avg = (dow / dow_dates).round(2)

    platform = df["platform"].map(_simplify_platform).value_counts()

    avg_min = round(float(df["ms_played"].mean()) / 60_000, 1) if len(df) else 0

    total_listening_days = int(df["ts"].dt.date.nunique())
    unique_countries = int(df["conn_country"].nunique())
    peak_hour_idx = int(hourly.idxmax()) if len(hourly) else 0
    peak_hour_label = f"{peak_hour_idx:02d}:00"
    peak_day = dow.idxmax() if len(dow) else "N/A"

    return {
        "hourly": {
            "labels": [f"{h:02d}:00" for h in range(24)],
            "values": hourly.values.tolist(),
            "avg_values": hourly_avg.values.tolist(),
        },
        "daily": {
            "labels": dow_order,
            "values": dow.values.tolist(),
            "avg_values": dow_avg.values.tolist(),
        },
        "shuffle": _bool_counts(df, "shuffle"),
        "skip": _bool_counts(df, "skipped"),
        "offline": _bool_counts(df, "offline"),
        "platform": {
            "labels": platform.index.tolist(),
            "values": [int(v) for v in platform.values],
        },
        "avg_track_min": avg_min,
        "total_listening_days": total_listening_days,
        "unique_countries": unique_countries,
        "peak_hour": peak_hour_label,
        "peak_day": peak_day,
    }


def _precompute(df: pd.DataFrame) -> dict:
    """Build cached aggregations used by multiple endpoints."""
    cache: dict = {}

    cache["global_stats"] = {
        "total_plays": int(len(df)),
        "total_hours": round(float(df["hours"].sum()), 1),
        "unique_artists": int(df["artist"].nunique()),
        "unique_tracks": int(df["track"].nunique()),
        "first_listen": str(df["ts"].min().date()),
        "last_listen": str(df["ts"].max().date()),
    }

    monthly = df.groupby("year_month")["hours"].sum().round(1)
    cache["monthly_hours"] = {
        "labels": monthly.index.tolist(),
        "values": monthly.values.tolist(),
    }

    artist_agg = df.groupby("artist").agg(
        plays=("track", "size"),
        hours=("hours", "sum"),
    ).sort_values("hours", ascending=False)
    artist_agg["hours"] = artist_agg["hours"].round(1)
    cache["artist_totals"] = artist_agg

    track_agg = df.groupby(["track", "artist", "album"]).agg(
        plays=("track", "size"),
        hours=("hours", "sum"),
    ).sort_values("hours", ascending=False)
    track_agg["hours"] = track_agg["hours"].round(1)
    cache["track_totals"] = track_agg

    cache["artist_names"] = artist_agg.reset_index()[["artist", "plays"]].values.tolist()
    cache["years"] = sorted(df["year"].unique().tolist())

    return cache


def _filter_by_date(
    df: pd.DataFrame,
    start_date: Optional[str],
    end_date: Optional[str],
    years: Optional[str] = None,
) -> pd.DataFrame:
    if years:
        year_list = [int(y) for y in years.split(",") if y.strip()]
        df = df[df["ts"].dt.year.isin(year_list)]
    if start_date:
        df = df[df["ts"] >= pd.to_datetime(start_date, utc=True)]
    if end_date:
        df = df[df["ts"] <= pd.to_datetime(end_date, utc=True)]
    return df


def _require_user_data(user_id: str) -> dict:
    """Get user data from TTL cache or raise 503."""
    data = _get_user_data(user_id)
    if data is None:
        raise HTTPException(status_code=503, detail="no_data")
    return data


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

def _build_frontend() -> None:
    """Run `npm run build` if dist/ is missing. Called from lifespan."""
    nm = os.path.join(_BASE, "node_modules")
    if not os.path.isdir(nm):
        print(
            "WARNING: node_modules not found. "
            "Run 'npm install && npm run build' before starting the server.",
            file=sys.stderr,
        )
        return
    print("dist/ not found — building frontend (npm run build)…", flush=True)
    try:
        result = subprocess.run(
            ["npm", "run", "build"],
            cwd=_BASE,
            timeout=180,
        )
        if result.returncode == 0:
            print("Frontend build complete.", flush=True)
        else:
            print("WARNING: Frontend build failed — app may not render correctly.", file=sys.stderr)
    except FileNotFoundError:
        print(
            "WARNING: npm not found. Install Node.js and run 'npm install && npm run build'.",
            file=sys.stderr,
        )
    except subprocess.TimeoutExpired:
        print("WARNING: Frontend build timed out.", file=sys.stderr)


@asynccontextmanager
async def lifespan(application: FastAPI):
    """Init databases and build frontend on startup."""
    os.makedirs(USERS_DIR, exist_ok=True)
    _init_image_db()
    _init_users_db()
    # Auto-build frontend if dist/ is missing
    if not os.path.isfile(_DIST_INDEX):
        _build_frontend()
    # Mount raw asset directory (logos, login backgrounds, etc.)
    _asset_dir = os.path.join(_BASE, "asset")
    if os.path.isdir(_asset_dir):
        application.mount("/asset", StaticFiles(directory=_asset_dir), name="asset")
    # Mount compiled assets (may have just been built above)
    if os.path.isdir(_DIST_ASSETS):
        application.mount("/assets", StaticFiles(directory=_DIST_ASSETS), name="assets")
    print(f"Ready. Users DB: {USERS_DB}  Image cache: {DB_PATH}")
    yield


_limiter = Limiter(key_func=get_remote_address)
app = FastAPI(title="Statify", lifespan=lifespan)
app.state.limiter = _limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(GZipMiddleware, minimum_size=500)


# ---------------------------------------------------------------------------
# Routes — static & auth
# ---------------------------------------------------------------------------

_DIST_INDEX = os.path.join(_BASE, "dist", "index.html")
_DIST_ASSETS = os.path.join(_BASE, "dist", "assets")


@app.get("/")
async def index():
    if os.path.isfile(_DIST_INDEX):
        return FileResponse(_DIST_INDEX)
    return FileResponse(os.path.join(_BASE, "index.html"))


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.get("/api/login-backgrounds")
async def login_backgrounds():
    bg_dir = os.path.join(_BASE, "asset", "login_backgrounds")
    if not os.path.isdir(bg_dir):
        return []
    exts = {".png", ".jpg", ".jpeg", ".webp", ".avif"}
    files = sorted(f for f in os.listdir(bg_dir) if os.path.splitext(f)[1].lower() in exts)
    return [f"/asset/login_backgrounds/{f}" for f in files]


@app.get("/api/users/search")
async def users_search(q: str = Query(..., min_length=1), viewer: dict | None = Depends(get_optional_user)):
    """Return public usernames with data matching query (excludes the viewer's own username)."""
    q_lower = q.lower()
    db = _get_users_db()
    rows = db.execute(
        "SELECT user_id, username FROM users WHERE is_public=1 AND LOWER(username) LIKE ?",
        (f"%{q_lower}%",),
    ).fetchall()
    results = []
    for row in rows:
        user_dir = _user_data_dir(row[0])
        if globmod.glob(os.path.join(user_dir, "Streaming_History_Audio_*.json")):
            results.append(row[1])
    if viewer:
        results = [u for u in results if u != viewer["username"]]
    return results[:10]


@app.post("/api/auth/login")
@_limiter.limit("10/minute")
async def login(request: Request):
    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    user = _db_get_user_by_username(username)
    if not user or not _bcrypt_lib.checkpw(password.encode(), user["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = _create_token(user["user_id"], user["username"])
    response = JSONResponse({
        "ok": True,
        "username": user["username"],
        "is_admin": user["username"] in _ADMIN_USERNAMES,
    })
    response.set_cookie(
        "auth_token", token,
        httponly=True,
        samesite="lax",
        secure=_SECURE_COOKIES,
        max_age=60 * 60 * 24 * JWT_EXPIRE_DAYS,
    )
    return response


@app.post("/api/auth/logout")
async def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("auth_token")
    return response


@app.get("/api/auth/me")
async def me(user: dict = Depends(get_current_user)):
    uconn = _get_users_db()
    row = uconn.execute("SELECT is_public FROM users WHERE user_id = ?", (user["sub"],)).fetchone()
    uconn.close()
    is_public = bool(row[0]) if row else True
    return {"user_id": user["sub"], "username": user["username"], "is_admin": bool(user.get("is_admin")), "is_public": is_public}


@app.patch("/api/users/me")
async def update_my_profile(request: Request, user: dict = Depends(get_current_user)):
    body = await request.json()
    if "is_public" in body:
        uconn = _get_users_db()
        uconn.execute("UPDATE users SET is_public = ? WHERE user_id = ?",
                      (int(bool(body["is_public"])), user["sub"]))
        uconn.commit()
        uconn.close()
    return {"ok": True}


@app.post("/admin/create-user")
async def create_user(request: Request):
    admin_secret = request.headers.get("X-Admin-Secret", "")
    if not ADMIN_SECRET or admin_secret != ADMIN_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")

    body = await request.json()
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""

    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="password must be at least 8 characters")

    try:
        user = _db_create_user(username, password)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Username already exists")

    os.makedirs(_user_data_dir(user["user_id"]), exist_ok=True)
    return {"ok": True, "user_id": user["user_id"], "username": user["username"]}


# ---------------------------------------------------------------------------
# Routes — admin panel API  (all require is_admin in JWT)
# ---------------------------------------------------------------------------

@app.get("/api/admin/overview")
async def admin_overview(_: dict = Depends(require_admin)):
    uconn = _get_users_db()
    user_count = uconn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    uconn.close()

    iconn = _get_db()
    artist_cached  = iconn.execute("SELECT COUNT(*) FROM artist_images").fetchone()[0]
    album_cached   = iconn.execute("SELECT COUNT(*) FROM album_images").fetchone()[0]
    genre_cached   = iconn.execute("SELECT COUNT(*) FROM artist_genres").fetchone()[0]
    empty_artists  = iconn.execute("SELECT COUNT(*) FROM artist_images WHERE image_url = ''").fetchone()[0]
    empty_albums   = iconn.execute("SELECT COUNT(*) FROM album_images WHERE image_url = ''").fetchone()[0]
    iconn.close()

    api_available = bool(os.getenv("SPOTIPY_CLIENT_ID") and os.getenv("SPOTIPY_CLIENT_SECRET"))
    return {
        "users": user_count,
        "artist_images_cached": artist_cached,
        "album_images_cached": album_cached,
        "artist_genres_cached": genre_cached,
        "empty_artist_images": empty_artists,
        "empty_album_images": empty_albums,
        "api_available": api_available,
    }


@app.get("/api/admin/users")
async def admin_list_users(_: dict = Depends(require_admin)):
    uconn = _get_users_db()
    rows = uconn.execute(
        "SELECT user_id, username, is_public, created_at FROM users ORDER BY created_at"
    ).fetchall()
    uconn.close()
    result = []
    for user_id, username, is_public, created_at in rows:
        data_dir = _user_data_dir(user_id)
        files = globmod.glob(os.path.join(data_dir, "Streaming_History_Audio_*.json"))
        file_count = len(files)
        size_mb = round(sum(os.path.getsize(f) for f in files) / 1_000_000, 2) if files else 0.0
        last_date = None
        for f in files:
            try:
                with open(f, encoding="utf-8") as fh:
                    entries = json.load(fh)
                for entry in entries:
                    ts = (entry.get("ts") or entry.get("endTime") or "")[:10]
                    if ts and (last_date is None or ts > last_date):
                        last_date = ts
            except Exception:
                pass
        result.append({
            "user_id": user_id,
            "username": username,
            "is_public": bool(is_public),
            "created_at": created_at,
            "file_count": file_count,
            "size_mb": size_mb,
            "data_date": last_date or "",
        })
    return result


@app.patch("/api/admin/users/{user_id}")
async def admin_update_user(user_id: str, request: Request, _: dict = Depends(require_admin)):
    body = await request.json()
    uconn = _get_users_db()
    row = uconn.execute("SELECT user_id FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        uconn.close()
        raise HTTPException(status_code=404, detail="User not found")
    if "is_public" in body:
        uconn.execute("UPDATE users SET is_public = ? WHERE user_id = ?", (int(bool(body["is_public"])), user_id))
    uconn.commit()
    uconn.close()
    return {"ok": True}


@app.post("/api/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, request: Request, _: dict = Depends(require_admin)):
    body = await request.json()
    password = body.get("password", "")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    pw_hash = _bcrypt_lib.hashpw(password.encode(), _bcrypt_lib.gensalt()).decode()
    uconn = _get_users_db()
    row = uconn.execute("SELECT user_id FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        uconn.close()
        raise HTTPException(status_code=404, detail="User not found")
    uconn.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", (pw_hash, user_id))
    uconn.commit()
    uconn.close()
    return {"ok": True}


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(user_id: str, admin: dict = Depends(require_admin)):
    if user_id == admin["sub"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    uconn = _get_users_db()
    row = uconn.execute("SELECT user_id FROM users WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        uconn.close()
        raise HTTPException(status_code=404, detail="User not found")
    uconn.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
    uconn.commit()
    uconn.close()
    # Remove data directory and evict TTL cache
    data_dir = _user_data_dir(user_id)
    if os.path.isdir(data_dir):
        shutil.rmtree(data_dir)
    _user_cache.pop(user_id, None)
    return {"ok": True}


@app.delete("/api/admin/users/{user_id}/data")
async def admin_clear_user_data(user_id: str, admin: dict = Depends(require_admin)):
    uconn = _get_users_db()
    row = uconn.execute("SELECT user_id FROM users WHERE user_id = ?", (user_id,)).fetchone()
    uconn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    data_dir = _user_data_dir(user_id)
    if os.path.isdir(data_dir):
        for f in globmod.glob(os.path.join(data_dir, "Streaming_History_Audio_*.json")):
            os.remove(f)
    _user_cache.pop(user_id, None)
    return {"ok": True}


@app.get("/api/admin/image-cache")
async def admin_image_cache(
    type: str = Query("artist", pattern="^(artist|album)$"),
    q: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    empty_only: bool = Query(False),
    _: dict = Depends(require_admin),
):
    offset = (page - 1) * limit
    iconn = _get_db()
    empty_clause = " AND image_url = ''" if empty_only else ""
    if type == "artist":
        search = f"%{q}%" if q else "%"
        total = iconn.execute(
            f"SELECT COUNT(*) FROM artist_images WHERE artist_name LIKE ?{empty_clause}", (search,)
        ).fetchone()[0]
        rows = iconn.execute(
            f"SELECT artist_name, image_url, fetched_at FROM artist_images WHERE artist_name LIKE ?{empty_clause} ORDER BY artist_name LIMIT ? OFFSET ?",
            (search, limit, offset),
        ).fetchall()
        items = [{"artist_name": r[0], "image_url": r[1], "fetched_at": r[2]} for r in rows]
    else:
        search = f"%{q}%" if q else "%"
        total = iconn.execute(
            f"SELECT COUNT(*) FROM album_images WHERE (album_name LIKE ? OR artist_name LIKE ?){empty_clause}", (search, search)
        ).fetchone()[0]
        rows = iconn.execute(
            f"SELECT album_name, artist_name, image_url, fetched_at FROM album_images WHERE (album_name LIKE ? OR artist_name LIKE ?){empty_clause} ORDER BY artist_name, album_name LIMIT ? OFFSET ?",
            (search, search, limit, offset),
        ).fetchall()
        items = [{"album_name": r[0], "artist_name": r[1], "image_url": r[2], "fetched_at": r[3]} for r in rows]
    iconn.close()
    return {"total": total, "page": page, "limit": limit, "items": items}


@app.delete("/api/admin/image-cache/artist/{name}")
async def admin_delete_artist_image(name: str, _: dict = Depends(require_admin)):
    iconn = _get_db()
    iconn.execute("DELETE FROM artist_images WHERE artist_name = ?", (name,))
    iconn.commit()
    iconn.close()
    return {"ok": True}


@app.delete("/api/admin/image-cache/album")
async def admin_delete_album_image(request: Request, _: dict = Depends(require_admin)):
    body = await request.json()
    album, artist = body.get("album", ""), body.get("artist", "")
    iconn = _get_db()
    iconn.execute("DELETE FROM album_images WHERE album_name = ? AND artist_name = ?", (album, artist))
    iconn.commit()
    iconn.close()
    return {"ok": True}


@app.put("/api/admin/image-cache/artist/{name}")
async def admin_set_artist_image(name: str, request: Request, _: dict = Depends(require_admin)):
    body = await request.json()
    image_url = body.get("image_url", "")
    now = datetime.now(timezone.utc).isoformat()
    iconn = _get_db()
    iconn.execute(
        "INSERT OR REPLACE INTO artist_images (artist_name, image_url, fetched_at) VALUES (?, ?, ?)",
        (name, image_url, now),
    )
    iconn.commit()
    iconn.close()
    return {"ok": True}


@app.put("/api/admin/image-cache/album")
async def admin_set_album_image(request: Request, _: dict = Depends(require_admin)):
    body = await request.json()
    album, artist, image_url = body.get("album", ""), body.get("artist", ""), body.get("image_url", "")
    now = datetime.now(timezone.utc).isoformat()
    iconn = _get_db()
    iconn.execute(
        "INSERT OR REPLACE INTO album_images (album_name, artist_name, image_url, fetched_at) VALUES (?, ?, ?, ?)",
        (album, artist, image_url, now),
    )
    iconn.commit()
    iconn.close()
    return {"ok": True}


@app.get("/api/admin/image-cache/search")
async def admin_search_image(
    q: str = Query(..., min_length=1),
    type: str = Query("artist", pattern="^(artist|album)$"),
    _: dict = Depends(require_admin),
):
    sp = get_client_credentials_client()
    results = []
    try:
        if _SPOTIFY_ID_RE.match(q):
            # Direct ID lookup — unambiguous, no search ranking
            if type == "artist":
                item = sp.artist(q)
                images = item.get("images", [])
                url = images[1]["url"] if len(images) > 1 else (images[0]["url"] if images else "")
                results.append({"name": item["name"], "id": item["id"], "image": url})
            else:
                item = sp.album(q)
                images = item.get("images", [])
                url = images[1]["url"] if len(images) > 1 else (images[0]["url"] if images else "")
                artist = item["artists"][0]["name"] if item.get("artists") else ""
                results.append({"name": item["name"], "artist": artist, "id": item["id"], "image": url})
        elif type == "artist":
            data = sp.search(q=f"artist:{q}", type="artist", limit=5)
            for item in data.get("artists", {}).get("items", []):
                images = item.get("images", [])
                url = images[1]["url"] if len(images) > 1 else (images[0]["url"] if images else "")
                results.append({"name": item["name"], "id": item["id"], "image": url})
        else:
            data = sp.search(q=f"album:{q}", type="album", limit=5)
            for item in data.get("albums", {}).get("items", []):
                images = item.get("images", [])
                url = images[1]["url"] if len(images) > 1 else (images[0]["url"] if images else "")
                artist = item["artists"][0]["name"] if item.get("artists") else ""
                results.append({"name": item["name"], "artist": artist, "id": item["id"], "image": url})
    except Exception:
        pass
    return results


@app.post("/api/admin/image-cache/refresh-empty")
async def admin_refresh_empty(
    type: str = Query("artist", pattern="^(artist|album)$"),
    _: dict = Depends(require_admin),
):
    iconn = _get_db()
    if type == "artist":
        rows = iconn.execute("SELECT artist_name FROM artist_images WHERE image_url = ''").fetchall()
        iconn.close()
        names = [r[0] for r in rows]
        before = len(names)
        if names:
            _get_artist_images_batch(names, cached_only=False)
        iconn2 = _get_db()
        still_empty = iconn2.execute(
            f"SELECT COUNT(*) FROM artist_images WHERE image_url = '' AND artist_name IN ({','.join('?' for _ in names)})",
            names,
        ).fetchone()[0] if names else 0
        iconn2.close()
    else:
        rows = iconn.execute("SELECT album_name, artist_name FROM album_images WHERE image_url = ''").fetchall()
        iconn.close()
        albums = [(r[0], r[1]) for r in rows]
        before = len(albums)
        if albums:
            _get_album_images_batch(albums, cached_only=False)
        iconn2 = _get_db()
        still_empty = iconn2.execute("SELECT COUNT(*) FROM album_images WHERE image_url = ''").fetchone()[0]
        iconn2.close()
    return {"attempted": before, "still_empty": still_empty, "refreshed": before - still_empty}


# ---------------------------------------------------------------------------
# Routes — current user data
# ---------------------------------------------------------------------------

@app.get("/api/status")
async def status(user: dict = Depends(get_current_user)):
    data = _get_user_data(user["sub"])
    return {"has_data": data is not None}


@app.post("/api/upload")
async def upload_data(
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only .zip files are accepted")

    content = await file.read()
    user_dir = _user_data_dir(user["sub"])
    os.makedirs(user_dir, exist_ok=True)

    # Remove existing audio JSON files before extracting new ones
    for existing in globmod.glob(os.path.join(user_dir, "Streaming_History_Audio_*.json")):
        os.remove(existing)

    extracted: list[str] = []
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            for member in zf.namelist():
                basename = os.path.basename(member)
                if basename.startswith("Streaming_History_Audio_") and basename.endswith(".json"):
                    dest = os.path.join(user_dir, basename)
                    with zf.open(member) as src, open(dest, "wb") as dst:
                        shutil.copyfileobj(src, dst)
                    extracted.append(basename)
    except zipfile.BadZipFile:
        raise HTTPException(status_code=422, detail="Invalid zip file")

    if not extracted:
        raise HTTPException(
            status_code=422,
            detail="No Streaming_History_Audio_*.json files found in zip",
        )

    _invalidate_user_cache(user["sub"])
    try:
        data = _get_user_data(user["sub"])
    except ValueError as e:
        for f in globmod.glob(os.path.join(user_dir, "Streaming_History_Audio_*.json")):
            os.remove(f)
        raise HTTPException(status_code=422, detail=str(e))

    if data is None:
        raise HTTPException(status_code=500, detail="Failed to load data after extraction")

    return {"ok": True, "files_loaded": len(extracted)}


@app.get("/api/dashboard")
async def dashboard(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    return _build_dashboard(ud["df"], ud["cache"], start_date, end_date, years)


@app.get("/api/top-artists")
async def top_artists(
    limit: int = Query(50, ge=1, le=500),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    return _build_top_artists(ud["df"], limit, start_date, end_date, years)


@app.get("/api/top-tracks")
async def top_tracks(
    limit: int = Query(50, ge=1, le=500),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    return _build_top_tracks(ud["df"], limit, start_date, end_date, years)


@app.get("/api/top-albums")
async def top_albums(
    limit: int = Query(50, ge=1, le=500),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    return _build_top_albums(ud["df"], limit, start_date, end_date, years)


@app.get("/api/timeline")
async def timeline(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    return _build_timeline(ud["df"], ud["cache"], start_date, end_date, years)


@app.get("/api/daily-heatmap")
async def daily_heatmap(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    df = ud["df"]
    mdf = df[(df["year"] == year) & (df["month"] == month)]
    daily = mdf.groupby(mdf["ts"].dt.day)["hours"].sum().round(2)
    days = {int(d): float(h) for d, h in daily.items()}
    total_days = calendar.monthrange(year, month)[1]
    return {"days": days, "total_days": total_days}


@app.get("/api/habits")
async def habits(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    df = _filter_by_date(ud["df"], start_date, end_date, years)
    result = _compute_habits(df)
    result["years"] = ud["cache"]["years"]
    return result


@app.get("/api/top-artists-brief")
async def top_artists_brief(user: dict = Depends(get_current_user)):
    """Return 5 random artists for suggestion chips, with images."""
    ud = _require_user_data(user["sub"])
    agg = ud["cache"]["artist_totals"].sample(5).reset_index()
    names = agg["artist"].tolist()
    imgs = _get_artist_images_batch(names, cached_only=True)
    return [
        {"name": row["artist"], "plays": int(row["plays"]), "image": imgs.get(row["artist"], "")}
        for _, row in agg.iterrows()
    ]


@app.get("/api/artists/search")
async def artist_search(
    q: str = Query(..., min_length=2),
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    q_lower = q.lower()
    results = [
        {"name": name, "plays": int(plays)}
        for name, plays in ud["cache"]["artist_names"]
        if q_lower in str(name).lower()
    ][:20]
    return results


@app.get("/api/artist/{artist_name}")
async def artist_detail(
    artist_name: str,
    user: dict = Depends(get_current_user),
):
    ud = _require_user_data(user["sub"])
    return _build_artist_detail(ud["df"], artist_name)


@app.post("/api/resolve-images")
async def resolve_images(
    request: Request,
    user: dict = Depends(get_current_user),
):
    body = await request.json()
    artist_names = body.get("artists", [])
    album_pairs = [tuple(a) for a in body.get("albums", [])]

    result: dict = {"artists": {}, "albums": {}}
    if artist_names:
        result["artists"] = _get_artist_images_batch(artist_names, cached_only=False)
    if album_pairs:
        imgs = _get_album_images_batch(album_pairs, cached_only=False)
        result["albums"] = {f"{a}||{b}": url for (a, b), url in imgs.items()}
    return result


@app.post("/api/resolve-genres")
async def resolve_genres(
    request: Request,
    user: dict = Depends(get_current_user),
):
    body = await request.json()
    artist_names = body.get("artists", [])
    if not artist_names:
        return {}
    return _get_artist_genres_batch(artist_names, cached_only=False)


# ---------------------------------------------------------------------------
# Routes — public profiles
# ---------------------------------------------------------------------------

def _resolve_public_user(username: str, viewer: dict | None = None) -> dict:
    """Look up user by username and verify they are public (or viewer is admin)."""
    user = _db_get_user_by_username(username)
    is_admin_viewer = viewer and viewer.get("is_admin")
    if not user or (not user["is_public"] and not is_admin_viewer):
        raise HTTPException(status_code=404, detail="User not found")
    return user


@app.get("/api/u/{username}/status")
async def public_status(username: str, viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    data = _get_user_data(user["user_id"])
    return {"username": username, "has_data": data is not None}


@app.get("/api/u/{username}/dashboard")
async def public_dashboard(username: str, viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    ud = _get_user_data(user["user_id"])
    if ud is None:
        raise HTTPException(status_code=404, detail="No data for this user")
    return _build_dashboard(ud["df"], ud["cache"])


@app.get("/api/u/{username}/top-artists")
async def public_top_artists(username: str, limit: int = Query(50, ge=1, le=500), viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    ud = _get_user_data(user["user_id"])
    if ud is None:
        raise HTTPException(status_code=404, detail="No data for this user")
    return _build_top_artists(ud["df"], limit)


@app.get("/api/u/{username}/top-tracks")
async def public_top_tracks(username: str, limit: int = Query(50, ge=1, le=500), viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    ud = _get_user_data(user["user_id"])
    if ud is None:
        raise HTTPException(status_code=404, detail="No data for this user")
    return _build_top_tracks(ud["df"], limit)


@app.get("/api/u/{username}/top-albums")
async def public_top_albums(username: str, limit: int = Query(50, ge=1, le=500), viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    ud = _get_user_data(user["user_id"])
    if ud is None:
        raise HTTPException(status_code=404, detail="No data for this user")
    return _build_top_albums(ud["df"], limit)


@app.get("/api/u/{username}/timeline")
async def public_timeline(username: str, viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    ud = _get_user_data(user["user_id"])
    if ud is None:
        raise HTTPException(status_code=404, detail="No data for this user")
    return _build_timeline(ud["df"], ud["cache"])


@app.get("/api/u/{username}/habits")
async def public_habits(username: str, viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    ud = _get_user_data(user["user_id"])
    if ud is None:
        raise HTTPException(status_code=404, detail="No data for this user")
    result = _compute_habits(ud["df"])
    result["years"] = ud["cache"]["years"]
    return result


@app.get("/api/u/{username}/artist/{artist_name}")
async def public_artist_detail(username: str, artist_name: str, viewer: dict | None = Depends(get_optional_user)):
    user = _resolve_public_user(username, viewer)
    ud = _get_user_data(user["user_id"])
    if ud is None:
        raise HTTPException(status_code=404, detail="No data for this user")
    return _build_artist_detail(ud["df"], artist_name)


# ---------------------------------------------------------------------------
# Routes — comparison
# ---------------------------------------------------------------------------

@app.get("/api/compare/{username_a}/{username_b}")
async def compare(username_a: str, username_b: str, viewer: dict | None = Depends(get_optional_user)):
    user_a = _resolve_public_user(username_a, viewer)
    user_b = _resolve_public_user(username_b, viewer)

    ud_a = _get_user_data(user_a["user_id"])
    ud_b = _get_user_data(user_b["user_id"])

    if ud_a is None or ud_b is None:
        raise HTTPException(status_code=404, detail="One or both users have no data")

    return _build_comparison(username_a, ud_a, username_b, ud_b)


@app.get("/api/compare")
async def compare_multi(users: str = Query(...), viewer: dict | None = Depends(get_optional_user)):
    """Multi-user comparison (2–5 users, comma-separated). First user is 'self' for similarity."""
    usernames = [u.strip() for u in users.split(",") if u.strip()]
    if len(usernames) < 2 or len(usernames) > 5:
        raise HTTPException(status_code=400, detail="Provide 2–5 usernames")
    if len(set(u.lower() for u in usernames)) != len(usernames):
        raise HTTPException(status_code=400, detail="Duplicate usernames")

    N_ARTISTS, N_TRACKS = 100, 50

    per_user = []
    for username in usernames:
        user = _resolve_public_user(username, viewer)
        ud = _get_user_data(user["user_id"])
        if ud is None:
            raise HTTPException(status_code=404, detail=f"No data for '{username}'")
        df = ud["df"]
        top_artists_ser = df.groupby("artist")["hours"].sum().nlargest(N_ARTISTS)
        top_tracks_ser  = df.groupby(["track", "artist"])["hours"].sum().nlargest(N_TRACKS)
        all_tracks_ser  = df.groupby(["track", "artist"])["hours"].sum()
        per_user.append({
            "username": username,
            "df": df,
            "top_artists":         set(top_artists_ser.index),
            "top_artists_ordered": list(top_artists_ser.index),
            "top_tracks":          set(top_tracks_ser.index),
            "top_tracks_ordered":  list(top_tracks_ser.index),
            "all_tracks_ser":      all_tracks_ser,
        })

    def _stats(df: pd.DataFrame) -> dict:
        return {
            "total_plays": int(len(df)),
            "total_hours": round(float(df["hours"].sum()), 1),
            "unique_artists": int(df["artist"].nunique()),
            "unique_tracks": int(df["track"].nunique()),
            "first_listen": str(df["ts"].min().date()),
            "last_listen": str(df["ts"].max().date()),
        }

    all_artists: set = set()
    for u in per_user:
        all_artists |= u["top_artists"]
    genres = _get_artist_genres_batch(list(all_artists), cached_only=True)
    genres_0 = {genres.get(a, "Other") for a in per_user[0]["top_artists"]}

    result_users = []
    for i, u in enumerate(per_user):
        if i == 0:
            sim = None
        else:
            ta0, tai = per_user[0]["top_artists"], u["top_artists"]
            tt0, tti = per_user[0]["top_tracks"], u["top_tracks"]
            genres_i = {genres.get(a, "Other") for a in tai}
            j_artists = len(ta0 & tai) / max(len(ta0 | tai), 1)
            j_tracks = len(tt0 & tti) / max(len(tt0 | tti), 1)
            g_overlap = len(genres_0 & genres_i) / max(len(genres_0 | genres_i), 1)
            sim = round((j_artists * 0.4 + j_tracks * 0.3 + g_overlap * 0.3) * 100)
        df_u = u["df"]
        hourly = [int((df_u[df_u["ts"].dt.hour == h]).shape[0]) for h in range(24)]
        skipped_df = df_u[df_u["skipped"] == True] if "skipped" in df_u.columns else df_u.iloc[0:0]
        skip_rate = round(len(skipped_df) / max(len(df_u), 1) * 100, 1)
        top_skipped_ser = (
            skipped_df.groupby("artist").size() / df_u.groupby("artist").size()
        ).dropna().nlargest(5)
        result_users.append({
            "username": u["username"],
            "stats": _stats(df_u),
            "similarity_to_first": sim,
            "hourly_plays": hourly,
            "skip_rate": skip_rate,
            "top_skipped_artists": [{"name": a, "rate": round(float(r) * 100, 1)} for a, r in top_skipped_ser.items()],
        })

    u0 = per_user[0]
    ta0, tt0 = u0["top_artists"], u0["top_tracks"]
    ta0_ord, tt0_ord = u0["top_artists_ordered"], u0["top_tracks_ordered"]

    pairs = []
    for ui in per_user[1:]:
        tai, tti = ui["top_artists"], ui["top_tracks"]
        tai_ord, tti_ord = ui["top_artists_ordered"], ui["top_tracks_ordered"]
        genres_a = {genres.get(a, "Other") for a in ta0}
        genres_i = {genres.get(a, "Other") for a in tai}
        j_art = len(ta0 & tai) / max(len(ta0 | tai), 1)
        j_trk = len(tt0 & tti) / max(len(tt0 | tti), 1)
        g_ov  = len(genres_a & genres_i) / max(len(genres_a | genres_i), 1)
        sim   = round((j_art * 0.4 + j_trk * 0.3 + g_ov * 0.3) * 100)
        shared_set = ta0 & tai
        shared_artists_ranked = sorted(
            shared_set,
            key=lambda a: ta0_ord.index(a) + tai_ord.index(a)
        )[:5]
        only_other_artists = [a for a in tai_ord if a not in ta0][:5]
        all_ser_0 = u0["all_tracks_ser"]
        all_ser_i = ui["all_tracks_ser"]
        combined_tracks = all_ser_0.add(all_ser_i, fill_value=0)
        shared_t_set = set(all_ser_0.index) & set(all_ser_i.index)
        shared_tracks_ranked = (
            combined_tracks[combined_tracks.index.isin(shared_t_set)]
            .nlargest(5)
            .index.tolist()
        )
        only_other_tracks = [t for t in tti_ord if t not in tt0][:5]
        imgs = _get_artist_images_batch(shared_artists_ranked + only_other_artists, cached_only=True)
        pairs.append({
            "username":           ui["username"],
            "similarity":         sim,
            "shared_artists":     [{"name": a, "image": imgs.get(a, "")} for a in shared_artists_ranked],
            "only_other_artists": [{"name": a, "image": imgs.get(a, "")} for a in only_other_artists],
            "shared_tracks":      [{"track": t, "artist": a} for t, a in shared_tracks_ranked],
            "only_other_tracks":  [{"track": t, "artist": a} for t, a in only_other_tracks],
            "artist_overlap":     {"shared": len(ta0 & tai), "only_other": len(tai - ta0), "only_self": len(ta0 - tai)},
        })
    return {"users": result_users, "pairs": pairs}


# ---------------------------------------------------------------------------
# Builder helpers (shared between personal + public endpoints)
# ---------------------------------------------------------------------------

def _build_dashboard(
    df: pd.DataFrame,
    cache: dict,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
) -> dict:
    df = _filter_by_date(df, start_date, end_date, years)

    stats = {
        "total_plays": int(len(df)),
        "total_hours": round(float(df["hours"].sum()), 1),
        "unique_artists": int(df["artist"].nunique()),
        "unique_tracks": int(df["track"].nunique()),
        "first_listen": str(df["ts"].min().date()) if len(df) else "N/A",
        "last_listen": str(df["ts"].max().date()) if len(df) else "N/A",
    }

    monthly = df.groupby("year_month")["hours"].sum().round(1)
    monthly_hours = {"labels": monthly.index.tolist(), "values": monthly.values.tolist()}

    artist_agg = df.groupby("artist")["hours"].sum().nlargest(5)
    artist_names = artist_agg.index.tolist()
    artist_imgs = _get_artist_images_batch(artist_names, cached_only=True)

    track_agg = df.groupby(["track", "artist", "album"])["hours"].sum().nlargest(5)
    track_labels = [t[0] for t in track_agg.index]
    track_albums = [(t[2], t[1]) for t in track_agg.index]
    album_imgs = _get_album_images_batch(track_albums, cached_only=True)

    return {
        "stats": stats,
        "monthly_hours": monthly_hours,
        "top_artists": {
            "labels": artist_names,
            "values": [round(float(v), 1) for v in artist_agg.values],
            "images": [artist_imgs.get(n, "") for n in artist_names],
        },
        "top_tracks": {
            "labels": track_labels,
            "values": [round(float(v), 1) for v in track_agg.values],
            "images": [album_imgs.get(a, "") for a in track_albums],
            "album_keys": [f"{a}||{b}" for a, b in track_albums],
            "album_pairs": [list(a) for a in track_albums],
        },
        "years": cache["years"],
    }


def _build_top_artists(
    df: pd.DataFrame,
    limit: int = 50,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
) -> dict:
    df = _filter_by_date(df, start_date, end_date, years)
    agg = df.groupby("artist").agg(
        plays=("track", "size"),
        hours=("hours", "sum"),
    ).sort_values("hours", ascending=False).head(limit)
    agg["hours"] = agg["hours"].round(1)
    rows = agg.reset_index()

    names = rows["artist"].tolist()
    imgs = _get_artist_images_batch(names, cached_only=True)
    genres = _get_artist_genres_batch(names, cached_only=True)

    table = rows.to_dict(orient="records")
    for row in table:
        row["image"] = imgs.get(row["artist"], "")
        row["genre"] = genres.get(row["artist"], "")

    return {
        "chart": {"labels": rows["artist"].tolist(), "values": [float(v) for v in rows["hours"]]},
        "table": table,
    }


def _build_top_tracks(
    df: pd.DataFrame,
    limit: int = 50,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
) -> dict:
    df = _filter_by_date(df, start_date, end_date, years)
    agg = df.groupby(["track", "artist", "album"]).agg(
        plays=("track", "size"),
        hours=("hours", "sum"),
    ).sort_values("hours", ascending=False).head(limit)
    agg["hours"] = agg["hours"].round(1)
    rows = agg.reset_index()

    albums = list(zip(rows["album"].tolist(), rows["artist"].tolist()))
    imgs = _get_album_images_batch(albums, cached_only=True)
    artist_names = rows["artist"].unique().tolist()
    artist_imgs = _get_artist_images_batch(artist_names, cached_only=True)
    genres = _get_artist_genres_batch(artist_names, cached_only=True)

    table = rows.to_dict(orient="records")
    for row in table:
        row["image"] = imgs.get((row["album"], row["artist"]), "")
        row["artist_image"] = artist_imgs.get(row["artist"], "")
        row["genre"] = genres.get(row["artist"], "")

    return {
        "chart": {"labels": rows["track"].tolist(), "values": [float(v) for v in rows["hours"]]},
        "table": table,
    }


def _build_top_albums(
    df: pd.DataFrame,
    limit: int = 50,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
) -> dict:
    df = _filter_by_date(df, start_date, end_date, years)
    agg = df.groupby(["album", "artist"]).agg(
        plays=("track", "size"),
        hours=("hours", "sum"),
        tracks=("track", "nunique"),
    ).sort_values("hours", ascending=False).head(limit)
    agg["hours"] = agg["hours"].round(1)
    rows = agg.reset_index()

    albums = list(zip(rows["album"].tolist(), rows["artist"].tolist()))
    imgs = _get_album_images_batch(albums, cached_only=True)
    artist_names = rows["artist"].unique().tolist()
    artist_imgs = _get_artist_images_batch(artist_names, cached_only=True)
    genres = _get_artist_genres_batch(artist_names, cached_only=True)

    table = rows.to_dict(orient="records")
    for row in table:
        row["image"] = imgs.get((row["album"], row["artist"]), "")
        row["artist_image"] = artist_imgs.get(row["artist"], "")
        row["genre"] = genres.get(row["artist"], "")

    return {
        "chart": {"labels": rows["album"].tolist(), "values": [float(v) for v in rows["hours"]]},
        "table": table,
    }


def _build_timeline(
    df: pd.DataFrame,
    cache: dict,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    years: Optional[str] = None,
) -> dict:
    df = _filter_by_date(df, start_date, end_date, years)
    yearly = df.groupby("year")["hours"].sum().round(1)
    yearly_data = {"labels": [int(y) for y in yearly.index], "values": yearly.values.tolist()}

    heatmap_raw = df.groupby(["year", "month"])["hours"].sum().round(1)
    heatmap: dict = {}
    for (y, m), h in heatmap_raw.items():
        heatmap.setdefault(int(y), {})[int(m)] = float(h)

    top_per_year: dict = {}
    all_top_artists: set = set()
    for year, grp in df.groupby("year"):
        top5 = grp.groupby("artist")["hours"].sum().nlargest(5)
        top_per_year[int(year)] = {a: round(float(h), 1) for a, h in top5.items()}
        all_top_artists.update(top5.index)

    years_sorted = sorted(top_per_year.keys())
    artist_totals = {a: sum(top_per_year.get(y, {}).get(a, 0) for y in years_sorted) for a in all_top_artists}
    artist_list = sorted(all_top_artists, key=lambda a: artist_totals[a], reverse=True)
    all_evo_artists = list(all_top_artists)
    evo_imgs = _get_artist_images_batch(all_evo_artists, cached_only=True)

    sankey_flows = []
    for i, year in enumerate(years_sorted[:-1]):
        next_year = years_sorted[i + 1]
        for artist in top_per_year.get(year, {}):
            if artist in top_per_year.get(next_year, {}):
                sankey_flows.append({
                    "from": f"{artist} ({year})",
                    "to": f"{artist} ({next_year})",
                    "flow": round(top_per_year[next_year][artist], 1),
                })

    sankey_nodes = {}
    for year in years_sorted:
        for artist, hours in top_per_year.get(year, {}).items():
            sankey_nodes[f"{artist} ({year})"] = {"artist": artist, "year": year, "hours": round(hours, 1)}

    evolution = {
        "labels": years_sorted,
        "artists": artist_list,
        "images": {a: evo_imgs.get(a, "") for a in all_evo_artists},
        "datasets": {a: [top_per_year.get(y, {}).get(a, 0) for y in years_sorted] for a in artist_list},
        "sankey_flows": sankey_flows,
        "sankey_nodes": sankey_nodes,
    }

    return {"yearly": yearly_data, "heatmap": heatmap, "evolution": evolution, "years": cache["years"]}


def _build_artist_detail(df: pd.DataFrame, artist_name: str) -> dict:
    adf = df[df["artist"] == artist_name]
    if adf.empty:
        raise HTTPException(status_code=404, detail="Artist not found")

    artist_imgs = _get_artist_images_batch([artist_name], cached_only=True)
    artist_image = artist_imgs.get(artist_name, "")

    stats = {
        "total_plays": int(len(adf)),
        "total_hours": round(float(adf["hours"].sum()), 1),
        "first_listen": str(adf["ts"].min().date()),
        "last_listen": str(adf["ts"].max().date()),
    }

    tracks = adf.groupby(["track", "album"]).agg(
        plays=("track", "size"),
        hours=("hours", "sum"),
    ).sort_values("hours", ascending=False).head(20)
    tracks["hours"] = tracks["hours"].round(1)
    tracks_list = tracks.reset_index().to_dict(orient="records")

    monthly = adf.groupby("year_month")["hours"].sum().round(1)
    monthly_data = {"labels": monthly.index.tolist(), "values": monthly.values.tolist()}

    albums_agg = adf.groupby("album").agg(
        plays=("track", "size"),
        hours=("hours", "sum"),
    ).sort_values("hours", ascending=False)
    albums_agg["hours"] = albums_agg["hours"].round(1)
    albums_reset = albums_agg.reset_index()

    album_keys = [(a, artist_name) for a in albums_reset["album"].tolist()]
    album_imgs = _get_album_images_batch(album_keys, cached_only=True)

    albums_data = {
        "labels": albums_reset["album"].tolist(),
        "values": [float(v) for v in albums_reset["hours"]],
        "images": [album_imgs.get((a, artist_name), "") for a in albums_reset["album"]],
    }

    return {
        "stats": stats,
        "artist_image": artist_image,
        "top_tracks": tracks_list,
        "monthly": monthly_data,
        "albums": albums_data,
    }


def _build_comparison(
    username_a: str, ud_a: dict,
    username_b: str, ud_b: dict,
) -> dict:
    N_ARTISTS = 100
    N_TRACKS = 50

    df_a, df_b = ud_a["df"], ud_b["df"]

    def _stats(df: pd.DataFrame) -> dict:
        return {
            "total_plays": int(len(df)),
            "total_hours": round(float(df["hours"].sum()), 1),
            "unique_artists": int(df["artist"].nunique()),
            "unique_tracks": int(df["track"].nunique()),
            "first_listen": str(df["ts"].min().date()),
            "last_listen": str(df["ts"].max().date()),
        }

    top_a_artists = set(df_a.groupby("artist")["hours"].sum().nlargest(N_ARTISTS).index)
    top_b_artists = set(df_b.groupby("artist")["hours"].sum().nlargest(N_ARTISTS).index)
    shared_artists = sorted(top_a_artists & top_b_artists)

    top_a_tracks = set(df_a.groupby(["track", "artist"])["hours"].sum().nlargest(N_TRACKS).index)
    top_b_tracks = set(df_b.groupby(["track", "artist"])["hours"].sum().nlargest(N_TRACKS).index)
    shared_tracks = sorted(top_a_tracks & top_b_tracks, key=lambda x: x[0])

    # Genre overlap
    all_artists = list((top_a_artists | top_b_artists))
    genres = _get_artist_genres_batch(all_artists, cached_only=True)
    genres_a = {genres.get(a, "Other") for a in top_a_artists}
    genres_b = {genres.get(a, "Other") for a in top_b_artists}
    genre_overlap = len(genres_a & genres_b) / max(len(genres_a | genres_b), 1)

    # Similarity score (0-100)
    jaccard_artists = len(top_a_artists & top_b_artists) / max(len(top_a_artists | top_b_artists), 1)
    jaccard_tracks = len(top_a_tracks & top_b_tracks) / max(len(top_a_tracks | top_b_tracks), 1)
    similarity_score = round((jaccard_artists * 0.4 + jaccard_tracks * 0.3 + genre_overlap * 0.3) * 100)

    # Images for shared artists
    shared_imgs = _get_artist_images_batch(shared_artists, cached_only=True)

    return {
        "user_a": {"username": username_a, "stats": _stats(df_a)},
        "user_b": {"username": username_b, "stats": _stats(df_b)},
        "overlap": {
            "similarity_score": similarity_score,
            "shared_artists": [
                {"name": a, "image": shared_imgs.get(a, "")} for a in shared_artists[:20]
            ],
            "shared_tracks": [
                {"track": t, "artist": a} for t, a in shared_tracks[:20]
            ],
            "only_a": sorted(top_a_artists - top_b_artists)[:15],
            "only_b": sorted(top_b_artists - top_a_artists)[:15],
        },
    }
