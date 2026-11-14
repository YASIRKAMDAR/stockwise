#!/usr/bin/env bash
# Restore an encrypted backup into a database (use a BLANK database for restore drills), then verify the ledger.
#   BACKUP_PASSPHRASE=... ./restore.sh stockwise-20261111T020000Z.dump.gpg postgresql://user:pass@host:5432/stockwise_restore
set -euo pipefail
FILE=${1:?encrypted backup file}; TARGET=${2:?target database URL}
[ -f "$FILE.sha256" ] && sha256sum -c "$FILE.sha256"
TMP=$(mktemp); trap 'rm -f "$TMP"' EXIT
gpg --batch --yes --pinentry-mode loopback --passphrase "${BACKUP_PASSPHRASE:?}" -d -o "$TMP" "$FILE"
pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET" "$TMP"
echo "restored; verifying balances against the immutable ledger…"
psql "$TARGET" -v ON_ERROR_STOP=1 -f "$(dirname "$0")/verify-ledger.sql"
