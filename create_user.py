"""Admin CLI for managing Spotify Tracker users.

Usage:
  python create_user.py list
  python create_user.py add <username>
  python create_user.py delete <username>
"""

import getpass
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone

import bcrypt as _bcrypt_lib

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "users.db")


def _connect():
    if not os.path.exists(DB_PATH):
        sys.exit(f"Database not found at {DB_PATH}\nStart the server once first to create it.")
    return sqlite3.connect(DB_PATH)


def cmd_list():
    conn = _connect()
    rows = conn.execute(
        "SELECT username, user_id, is_public, created_at FROM users ORDER BY created_at"
    ).fetchall()
    conn.close()
    if not rows:
        print("No users yet.")
        return
    print(f"{'Username':<20} {'Public':<8} {'Created':<26} {'User ID'}")
    print("-" * 85)
    for username, user_id, is_public, created_at in rows:
        pub = "yes" if is_public else "no"
        print(f"{username:<20} {pub:<8} {created_at:<26} {user_id}")


def cmd_add(username: str):
    password = getpass.getpass(f"Password for '{username}': ")
    if not password:
        sys.exit("Password cannot be empty.")
    confirm = getpass.getpass("Confirm password: ")
    if password != confirm:
        sys.exit("Passwords do not match.")

    user_id = str(uuid.uuid4())
    password_hash = _bcrypt_lib.hashpw(password.encode(), _bcrypt_lib.gensalt()).decode()
    now = datetime.now(timezone.utc).isoformat()

    conn = _connect()
    try:
        conn.execute(
            "INSERT INTO users (user_id, username, password_hash, is_public, created_at) VALUES (?,?,?,1,?)",
            (user_id, username, password_hash, now),
        )
        conn.commit()
        print(f"Created user '{username}' (id: {user_id})")
    except sqlite3.IntegrityError:
        print(f"Username '{username}' already exists.")
    finally:
        conn.close()


def cmd_delete(username: str):
    conn = _connect()
    row = conn.execute("SELECT user_id FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        conn.close()
        sys.exit(f"User '{username}' not found.")
    answer = input(f"Delete user '{username}'? This cannot be undone. [y/N] ").strip().lower()
    if answer != "y":
        print("Aborted.")
        conn.close()
        return
    conn.execute("DELETE FROM users WHERE username = ?", (username,))
    conn.commit()
    conn.close()
    print(f"Deleted user '{username}'.")


USAGE = """Usage:
  python create_user.py list
  python create_user.py add <username>
  python create_user.py delete <username>"""

if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(USAGE)
    elif args[0] == "list":
        cmd_list()
    elif args[0] == "add" and len(args) == 2:
        cmd_add(args[1])
    elif args[0] == "delete" and len(args) == 2:
        cmd_delete(args[1])
    else:
        print(USAGE)
