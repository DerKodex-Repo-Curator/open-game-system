#!/usr/bin/env bash
# create-ogs-app end to end, from a clean directory to the game on an iOS simulator:
#   1. a throwaway Verdaccio registry (127.0.0.1, free port, temp storage, npmjs for everything else)
#   2. create-ogs-app, @open-game-system/shell and the workspace packages it needs, built and published
#      there at <version>-e2e.<stamp> (package.json files are put back; no git changes)
#   3. in a fresh temp dir, with only npm_config_registry pointing at it: pnpm create ogs-app,
#      pnpm install, pnpm typecheck, expo prebuild, a Release simulator build (JS bundle embedded)
#   4. its own simulator (xcrun simctl create): install, launch, and Maestro waits for the game's page
#      in the WebView
#   5. on exit, pass or fail: registry stopped, simulator deleted, temp dirs removed
#
# macOS with Xcode, CocoaPods and Maestro (~/.maestro/bin/maestro). Not in GitHub CI (macOS runners).
#   packages/create-ogs-app/scripts/e2e-simulator.sh
# Environment (all optional):
#   E2E_GAME_URL    the game's phone page (default: Rocket Crew's /host)
#   E2E_EXPECT      Maestro regex for text the game's page shows (default: Rocket Crew's name gate / lobby)
#   E2E_WAIT_MS     how long Maestro waits for it (default 180000)
#   E2E_LOGS        keep logs, screenshots and timings here (default: a temp dir, removed on success)
#   E2E_DEVICE_TYPE simctl device type (default iPhone 16 Pro); E2E_RUNTIME (default: newest iOS)
#   E2E_KEEP=1      keep the work dir (app, build) and the simulator for a look afterwards
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
game_url="${E2E_GAME_URL:-https://rocket-crew.jonathanrmumm.workers.dev/host}"
# Rocket Crew's phone page before a seat ("Who's playing here?" / "Joining …") or in the lobby.
rocket_crew_text="(Who's playing here\\?|Joining .*|Captain: .*)"
expect="${E2E_EXPECT:-$rocket_crew_text}"
wait_ms="${E2E_WAIT_MS:-180000}"
device_type="${E2E_DEVICE_TYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro}"
maestro="${MAESTRO:-$HOME/.maestro/bin/maestro}"
bundle_id="com.example.e2egame"
stamp="$(date +%Y%m%d%H%M%S)"
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}" # CocoaPods needs UTF-8

work="$(mktemp -d "${TMPDIR:-/tmp}/ogs-e2e.XXXXXX")"
work="$(cd "$work" && pwd -P)"
logs="${E2E_LOGS:-$work-logs}"
mkdir -p "$logs"
udid=""
ok=0
timings=()
t0=$SECONDS

cleanup() {
  local code=$?
  set +e
  node "$here/e2e-publish.mjs" restore "$work"
  pkill -f "$work/verdaccio/config.yaml" 2>/dev/null
  if [ -n "$udid" ] && [ "${E2E_KEEP:-}" != 1 ]; then
    xcrun simctl shutdown "$udid" >/dev/null 2>&1
    xcrun simctl delete "$udid" >/dev/null 2>&1
  fi
  [ "${E2E_KEEP:-}" = 1 ] || rm -rf "$work"
  printf '%s\n' "${timings[@]}" "total $((SECONDS - t0))s" >"$logs/timings.txt"
  if [ "$ok" = 1 ]; then
    echo "PASS in $((SECONDS - t0))s"
    [ -n "${E2E_LOGS:-}" ] || rm -rf "$logs"
  else
    echo "FAIL (exit $code) after $((SECONDS - t0))s; logs: $logs" >&2
  fi
  [ "${E2E_KEEP:-}" != 1 ] || echo "kept: $work, simulator $udid"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

killtree() {
  local child
  for child in $(pgrep -P "$1"); do killtree "$child"; done
  kill -TERM "$1" 2>/dev/null || true
}

# step <name> <timeout seconds> <command…>: runs it with its output in $logs/<name>.log, fails on
# a non-zero exit or the timeout, and records how long it took.
step() {
  local name="$1" limit="$2" start=$SECONDS pid dog code=0
  shift 2
  echo "==> $name"
  "$@" >"$logs/$name.log" 2>&1 &
  pid=$!
  (sleep "$limit" && echo "timed out after ${limit}s" >>"$logs/$name.log" && killtree "$pid") 2>/dev/null &
  dog=$!
  wait "$pid" || code=$?
  pkill -P "$dog" 2>/dev/null || true
  kill "$dog" 2>/dev/null || true
  timings+=("$name $((SECONDS - start))s")
  if [ "$code" != 0 ]; then
    echo "$name failed ($code); last lines of $logs/$name.log:" >&2
    tail -40 "$logs/$name.log" >&2
    return "$code"
  fi
}

# 1. The registry: local packages only from here, everything else proxied from npmjs.
port="$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
registry="http://127.0.0.1:$port/"
mkdir -p "$work/verdaccio"
cat >"$work/verdaccio/config.yaml" <<YAML
storage: $work/verdaccio/storage
auth:
  htpasswd:
    file: $work/verdaccio/htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    timeout: 120s
packages:
  "@open-game-system/*":
    access: \$all
    publish: \$authenticated
  "create-ogs-app":
    access: \$all
    publish: \$authenticated
  "**":
    access: \$all
    proxy: npmjs
max_body_size: 200mb
server:
  keepAliveTimeout: 120
log: { type: stdout, format: pretty, level: warn }
YAML
npx -y verdaccio@6 --config "$work/verdaccio/config.yaml" --listen "127.0.0.1:$port" \
  >"$logs/verdaccio.log" 2>&1 &
wait_for_registry() { until curl -sf "${registry}-/ping" >/dev/null; do sleep 2; done; }
step registry 300 wait_for_registry

# A throwaway user on the throwaway registry, for npm publish.
token="$(curl -sf -X PUT -H 'content-type: application/json' \
  -d '{"name":"e2e","password":"e2e-local-only"}' "${registry}-/user/org.couchdb.user:e2e" |
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
printf 'registry=%s\n//127.0.0.1:%s/:_authToken=%s\n' "$registry" "$port" "$token" >"$work/npmrc"

# 2. Build and publish.
step build 1800 pnpm -C "$repo" --filter "@open-game-system/shell..." --filter create-ogs-app run build
step publish 900 env NPM_CONFIG_USERCONFIG="$work/npmrc" \
  node "$here/e2e-publish.mjs" publish "$registry" "e2e.$stamp" "$work"
shell_version="$(tail -1 "$logs/publish.log")"
echo "    shell $shell_version"

# 3. A new app, as a developer makes it (only the registry differs).
export npm_config_registry="$registry"
mkdir -p "$work/project"
app="$work/project/e2e-game"
create() {
  cd "$work/project" && pnpm create ogs-app e2e-game --app-id e2e-game --name "E2E Game" \
    --game-url "$game_url" --bundle-id "$bundle_id" --team-id - --no-link-domain \
    --shell-version "$shell_version" -y
}
step create 900 create
step install 2400 pnpm -C "$app" install
step typecheck 600 pnpm -C "$app" typecheck
prebuild() { cd "$app" && CI=1 npx expo prebuild --platform ios; }
step prebuild 2400 prebuild

# A Release build embeds the JS bundle: the app runs with no Metro.
ios_build() {
  local ws scheme
  ws="$(ls -d "$app"/ios/*.xcworkspace | head -1)"
  scheme="$(basename "$ws" .xcworkspace)"
  xcodebuild -workspace "$ws" -scheme "$scheme" -configuration Release -sdk iphonesimulator \
    -destination "generic/platform=iOS Simulator" -derivedDataPath "$work/build" \
    ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=NO build
}
step xcodebuild 7200 ios_build
app_path="$(ls -d "$work"/build/Build/Products/Release-iphonesimulator/*.app | head -1)"

# 4. Its own simulator.
runtime="${E2E_RUNTIME:-$(xcrun simctl list runtimes -j | node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const ios=JSON.parse(s).runtimes.filter(r=>r.isAvailable&&r.platform==="iOS");
  console.log(ios[ios.length-1].identifier)})')}"
udid="$(xcrun simctl create "ogs-e2e-$stamp" "$device_type" "$runtime")"
echo "    simulator ogs-e2e-$stamp ($udid)"
step boot 900 xcrun simctl bootstatus "$udid" -b
step install-app 600 xcrun simctl install "$udid" "$app_path"
step launch 300 xcrun simctl launch "$udid" "$bundle_id"

cat >"$work/flow.yaml" <<'YAML'
# The game's page is in the shell's WebView: text only the game shows (the shell's loading screen
# shows the app's name, "E2E Game").
appId: com.example.e2egame
---
- extendedWaitUntil:
    visible: ${EXPECT}
    timeout: ${WAIT_MS}
- takeScreenshot: game
YAML
see_game() {
  cd "$logs" && "$maestro" --device "$udid" test --test-output-dir "$logs/maestro" \
    -e EXPECT="$expect" -e WAIT_MS="$wait_ms" "$work/flow.yaml"
}
step maestro 1200 see_game
xcrun simctl io "$udid" screenshot "$logs/simulator.png" >/dev/null 2>&1 || true
ok=1
