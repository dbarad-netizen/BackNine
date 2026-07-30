#!/usr/bin/env python3
"""
Generate the Apple Sign in with Apple client secret (JWT) that Supabase
requires in its Apple provider "Secret Key (for OAuth)" field.

Apple's OAuth flow doesn't accept the .p8 file directly as a client secret —
it wants a JWT signed with the .p8 key. The JWT has to be regenerated
every 6 months (max), so keep this script around and re-run it.

USAGE:
    python3 docs/app-store/generate_apple_client_secret.py \\
        --p8      ~/Downloads/AuthKey_XXXXXXXXXX.p8 \\
        --team-id 5TU6C6ND63 \\
        --key-id  XXXXXXXXXX \\
        --client-id com.strategyd.backnine.signin

The script prints ONE line — the JWT. Copy it and paste into
Supabase Dashboard → Authentication → Providers → Apple → Secret Key.

REQUIREMENTS:
    pip install PyJWT cryptography --break-system-packages

(the --break-system-packages flag is needed on modern macOS pythons)

SECURITY:
    Your .p8 file is a private key. Never commit it. Never paste it into
    a website. This script reads it locally and produces only the JWT.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

try:
    import jwt   # PyJWT
except ImportError:
    print(
        "ERROR: PyJWT not installed. Run:\n"
        "  pip install PyJWT cryptography --break-system-packages",
        file=sys.stderr,
    )
    sys.exit(1)


def build_client_secret(
    p8_path:   str,
    team_id:   str,
    key_id:    str,
    client_id: str,
    valid_days: int = 180,     # Apple max is 6 months
) -> str:
    p8 = Path(p8_path).expanduser().read_text()
    now = int(time.time())
    payload = {
        "iss": team_id,
        "iat": now,
        "exp": now + (valid_days * 24 * 60 * 60),
        "aud": "https://appleid.apple.com",
        "sub": client_id,
    }
    headers = {"kid": key_id, "alg": "ES256"}
    return jwt.encode(payload, p8, algorithm="ES256", headers=headers)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--p8",       required=True, help="Path to your AuthKey_XXXXXXXXXX.p8 file")
    parser.add_argument("--team-id",  required=True, help="Apple Team ID (10 chars, e.g. 5TU6C6ND63)")
    parser.add_argument("--key-id",   required=True, help="Key ID from the Sign in with Apple key you created")
    parser.add_argument("--client-id",required=True, help="Services ID (e.g. com.strategyd.backnine.signin)")
    parser.add_argument("--valid-days", type=int, default=180, help="JWT validity in days (max 180 = 6 months)")
    args = parser.parse_args()

    token = build_client_secret(
        p8_path   = args.p8,
        team_id   = args.team_id,
        key_id    = args.key_id,
        client_id = args.client_id,
        valid_days= args.valid_days,
    )
    print(token)
    return 0


if __name__ == "__main__":
    sys.exit(main())
