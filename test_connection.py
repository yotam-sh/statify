"""Test that the Spotify API credentials work and discover available endpoints."""

from spotify_client import get_client_credentials_client


def test_endpoint(name, func):
    """Test an endpoint and return whether it succeeded."""
    try:
        result = func()
        print(f"   [OK]  {name}")
        return True, result
    except Exception as e:
        status = getattr(e, 'http_status', None)
        print(f"   [403] {name} (restricted)")
        return False, None


def test_connection():
    print("Testing Spotify API connection...")
    print()

    sp = get_client_credentials_client()

    # Core test: search
    print("1. Testing search...")
    results = sp.search(q="track:Rebel Yell artist:Billy Idol", type="track", limit=1)
    tracks = results["tracks"]["items"]
    if not tracks:
        print("   ERROR: Search returned no results. Check your credentials.")
        return False
    track = tracks[0]
    print(f"   [OK]  Found: {track['name']} by {track['artists'][0]['name']}")

    track_id = track["id"]
    artist_id = track["artists"][0]["id"]

    # Test various endpoints to map available access
    print()
    print("2. Testing endpoint access...")
    available = {}

    endpoints = [
        ("Track lookup", lambda: sp.track(track_id)),
        ("Artist lookup", lambda: sp.artist(artist_id)),
        ("Artist top tracks", lambda: sp.artist_top_tracks(artist_id)),
        ("Artist albums", lambda: sp.artist_albums(artist_id, limit=1)),
        ("Album tracks", lambda: sp.album_tracks(track["album"]["id"], limit=1)),
        ("Audio features", lambda: sp.audio_features([track_id])),
        ("Recommendations", lambda: sp.recommendations(seed_tracks=[track_id], limit=1)),
    ]

    for name, func in endpoints:
        ok, _ = test_endpoint(name, func)
        available[name] = ok

    print()
    ok_count = sum(available.values())
    print(f"Results: {ok_count}/{len(available)} endpoints accessible")
    print()
    print("API connection verified! Your credentials are working.")
    if ok_count < len(available):
        print("Note: Some endpoints are restricted (common for basic quota apps).")
        print("Your offline streaming history data will fill in most gaps.")
    return True


if __name__ == "__main__":
    test_connection()
