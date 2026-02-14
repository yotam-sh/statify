"""Explore what data each working endpoint returns."""

import json
from spotify_client import get_client_credentials_client

sp = get_client_credentials_client()

# 1. Track lookup
print("=" * 60)
print("TRACK LOOKUP (sp.track)")
print("=" * 60)
track = sp.track("4TIJ7zSBNejpoIPaWpWRKc")  # Rebel Yell
print(json.dumps(track, indent=2))

# 2. Artist lookup
print("\n" + "=" * 60)
print("ARTIST LOOKUP (sp.artist)")
print("=" * 60)
artist = sp.artist(track["artists"][0]["id"])
print(json.dumps(artist, indent=2))

# 3. Artist albums
print("\n" + "=" * 60)
print("ARTIST ALBUMS (sp.artist_albums, limit=2)")
print("=" * 60)
albums = sp.artist_albums(track["artists"][0]["id"], limit=2)
print(json.dumps(albums, indent=2))

# 4. Album tracks
print("\n" + "=" * 60)
print("ALBUM TRACKS (sp.album_tracks, limit=3)")
print("=" * 60)
album_tracks = sp.album_tracks(track["album"]["id"], limit=3)
print(json.dumps(album_tracks, indent=2))

# 5. Search (track, artist, album)
print("\n" + "=" * 60)
print("SEARCH (type=track, limit=1)")
print("=" * 60)
search = sp.search(q="Bohemian Rhapsody", type="track", limit=1)
print(json.dumps(search, indent=2))

# 6. Full album lookup
print("\n" + "=" * 60)
print("ALBUM LOOKUP (sp.album)")
print("=" * 60)
album = sp.album(track["album"]["id"])
print(json.dumps(album, indent=2))

# 7. Multiple tracks at once
print("\n" + "=" * 60)
print("MULTIPLE TRACKS (sp.tracks, 3 tracks)")
print("=" * 60)
multi = sp.tracks(["4TIJ7zSBNejpoIPaWpWRKc", "3AhXZa8sUQht0UEdBJgpGc", "7tFiyTwD0nx5a1eklYtX2J"])
print(json.dumps({"track_count": len(multi["tracks"]), "sample_keys": list(multi["tracks"][0].keys())}, indent=2))
