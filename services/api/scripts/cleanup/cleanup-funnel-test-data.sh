#!/bin/zsh
# Removes the 2026-10-18 stranger-funnel test data from production D1 (see the .sql file).
#   services/api/scripts/cleanup/cleanup-funnel-test-data.sh           counts what it would delete
#   services/api/scripts/cleanup/cleanup-funnel-test-data.sh --apply   deletes it
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=opengame-api-db
D=86db4991-8a59-463c-a1e2-5d8a26181c31
G=2543d34f-11c0-426d-99d6-d598e5a80394
S=0829e155-2007-4ce0-9049-f5386dd7d1e1
count() {
  npx wrangler d1 execute "$DB" --remote --command "SELECT
    (SELECT group_concat(name) FROM profiles WHERE id IN ('$D','$G')) AS profiles,
    (SELECT count(*) FROM profile_devices WHERE profile_id IN ('$D','$G')) AS devices,
    (SELECT count(*) FROM session_members WHERE session_id='$S' OR profile_id IN ('$D','$G')) AS members,
    (SELECT count(*) FROM guest_profiles WHERE profile_id='$G') AS guests,
    (SELECT count(*) FROM instances WHERE profile_id IN ('$D','$G')) AS instances,
    (SELECT group_concat(code) FROM couch_sessions WHERE id='$S') AS couch,
    (SELECT group_concat(code) FROM screens WHERE id IN ('0e83a29f-72bd-4703-b429-2d7236c51c41','ac2b20e9-e6ed-4368-8ab6-94072fa693a4','8458505f-f863-4722-ab26-0073aea55f7b')) AS screens"
}
if [ "${1:-}" != "--apply" ]; then
  count
  echo "Nothing deleted. Run again with --apply to delete these rows."
  exit 0
fi
npx wrangler d1 execute "$DB" --remote --file scripts/cleanup/2026-10-18-funnel-test-data.sql
count
