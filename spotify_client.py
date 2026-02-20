"""Spotify API client wrapper using spotipy."""

import os
from dotenv import load_dotenv
import spotipy
from spotipy.oauth2 import SpotifyClientCredentials, SpotifyOAuth

load_dotenv()


def get_client_credentials_client() -> spotipy.Spotify:
    """Get a Spotify client using Client Credentials flow (no user auth needed).

    Good for: searching tracks, getting artist/album/track info, audio features.
    """
    return spotipy.Spotify(
        auth_manager=SpotifyClientCredentials(
            client_id=os.getenv("SPOTIPY_CLIENT_ID"),
            client_secret=os.getenv("SPOTIPY_CLIENT_SECRET"),
        ),
        retries=0,
    )


def get_user_client(scope: str = "user-read-recently-played user-top-read user-library-read") -> spotipy.Spotify:
    """Get a Spotify client using Authorization Code flow (user auth required).

    Good for: reading user's top tracks/artists, recent plays, saved library.
    """
    return spotipy.Spotify(
        auth_manager=SpotifyOAuth(
            client_id=os.getenv("SPOTIPY_CLIENT_ID"),
            client_secret=os.getenv("SPOTIPY_CLIENT_SECRET"),
            redirect_uri=os.getenv("SPOTIPY_REDIRECT_URI", "http://localhost:8888/callback"),
            scope=scope,
            cache_path=".spotify_cache",
        )
    )
