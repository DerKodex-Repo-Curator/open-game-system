#!/usr/bin/env bash
# Every ogs command, end to end, against a preview API (docs/design-docs/ogs-cli.md).
#
#   OGS_API=https://opengame-api-pr-shell.jonathanrmumm.workers.dev \
#   OGS_KEY_FILE=<file with rocket-crew's preview game key> OGS_ADMIN_TOKEN_FILE=<file> \
#   TRY_URL=https://rocket-crew-try.jonathanrmumm.workers.dev packages/cli/scripts/e2e-preview.sh
#
# Keys are read from files and never printed. Uses rocket-crew (its preview key) for the game.
set -uo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
ogs() { node "$here/dist/bin.mjs" "$@"; }
work="$(mktemp -d)"
export OGS_CONFIG_DIR="$work/config"
APP=rocket-crew
pass=0
fail=0
step() { # step <name> <expected exit> <command...>
  local name="$1" want="$2"
  shift 2
  local out code
  out="$("$@" 2>&1)"
  code=$?
  if [ "$code" = "$want" ]; then pass=$((pass + 1)); echo "PASS $name"; else fail=$((fail + 1)); echo "FAIL $name (exit $code, wanted $want)"; fi
  echo "$out" | sed 's/^/     /' | head -12
}

step "login" 0 ogs login --app "$APP" --key "$(cat "$OGS_KEY_FILE")"

# manifest check + publish: the game's catalogue manifest as its ogs.manifest.json.
curl -s "$OGS_API/api/v1/catalogue" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const g=JSON.parse(s).find(x=>x.appId===process.argv[1]);const {tryUrl,...m}=g;process.stdout.write(JSON.stringify({...m,tagline:m.tagline.replace(/ \(e2e \d+\)/g,"")+" (e2e "+Date.now()+")"},null,2))})' "$APP" > "$work/ogs.manifest.json"
step "manifest check" 0 ogs manifest check "$work/ogs.manifest.json"
echo '{"appId":"rocket-crew","name":"x"}' > "$work/bad.manifest.json"
step "manifest check (bad manifest exits 1)" 1 ogs manifest check "$work/bad.manifest.json" --offline
step "publish" 0 ogs publish "$work/ogs.manifest.json"
step "publish --status (pending)" 0 ogs publish --status
curl -s -o /dev/null -w "     admin approve: HTTP %{http_code}\n" -X POST -H "Authorization: Bearer $(cat "$OGS_ADMIN_TOKEN_FILE")" "$OGS_API/api/v1/admin/catalogue-entries/$APP/approve"
step "publish --status (live)" 0 ogs publish --status

# try: register the game's deployed try path.
step "try --check-only --url" 0 ogs try --check-only --url "$TRY_URL"
step "try (not a try path: 1)" 1 ogs try --check-only --url https://example.com
tryurl="$(curl -s "$OGS_API/api/v1/catalogue" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).find(x=>x.appId===process.argv[1]).tryUrl??"")})' "$APP")"
if [ "$tryurl" = "$TRY_URL" ]; then pass=$((pass + 1)); echo "PASS catalogue carries tryUrl"; else fail=$((fail + 1)); echo "FAIL catalogue tryUrl is '$tryurl'"; fi

# push send: a fresh player profile on the preview opts in; its handle gets a test push.
device="e2e-$(date +%s)"
token="$(curl -s -X POST "$OGS_API/api/v1/profiles" -H 'content-type: application/json' -d "{\"name\":\"Ada\",\"sticker\":\"owl\",\"device\":{\"deviceId\":\"$device\",\"kind\":\"phone\",\"name\":\"Phone\"}}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')"
handle="$(curl -s -X POST "$OGS_API/api/v1/games/$APP/push-handles" -H "authorization: Bearer $token" -H 'content-type: application/json' -d '{}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).handle))')"
step "push send --check (no app device yet: nowhere, exit 1)" 1 ogs push send --to "$handle" --check
# The game's own app registers this phone's APNs token; the push goes to Apple with the app's key.
curl -s -o /dev/null -w "     app device: HTTP %{http_code}\n" -X PUT "$OGS_API/api/v1/apps/$APP/devices/$device" -H "authorization: Bearer $token" -H 'content-type: application/json' \
  -d "{\"platform\":\"ios\",\"token\":\"$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')\",\"apnsEnvironment\":\"sandbox\"}"
step "push send --check (app surface)" 0 ogs push send --to "$handle" --check
origin="$(node -e 'console.log(new URL(require(process.argv[1]).startUrl).origin)' "$work/ogs.manifest.json")"
# The preview's APNs key is a throwaway, so Apple refuses it: exit 1 with Apple's answer (the full send path ran).
step "push send (throwaway key: Apple refuses, exit 1)" 1 ogs push send --to "$handle" --title "e2e" --body "a test push" --url "$origin/"

# init: a small Vite game (pushd, not a subshell, so the counts add up), dry then real (kits from the preview docs, via GET /dev/kits).
mkdir -p "$work/game/src"
echo '{"name":"comet-catch","private":true,"devDependencies":{"vite":"^7.0.0"}}' > "$work/game/package.json"
touch "$work/game/pnpm-lock.yaml"
printf '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n' > "$work/game/index.html"
echo 'console.log("comet catch")' > "$work/game/src/main.ts"
pushd "$work/game" > /dev/null
step "init --dry" 0 ogs init --app-id comet-catch --name "Comet Catch" --start-url https://comet.example/ --shape couch --tv required --dry
[ ! -e "$work/game/ogs.manifest.json" ] && { pass=$((pass + 1)); echo "PASS init --dry wrote nothing"; } || { fail=$((fail + 1)); echo "FAIL init --dry wrote files"; }
step "init" 0 ogs init --app-id comet-catch --name "Comet Catch" --start-url https://comet.example/ --shape couch --tv required
for f in ogs.manifest.json OGS.md vendor/profile-kit.tgz vendor/try-kit.tgz; do
  [ -s "$work/game/$f" ] && { pass=$((pass + 1)); echo "PASS init wrote $f"; } || { fail=$((fail + 1)); echo "FAIL init didn't write $f"; }
done
step "manifest check (the init'd manifest, offline)" 0 ogs manifest check --offline
popd > /dev/null

# dev: the harness, its JWKS, and a phone page (the deployed game, proxied) with the fake bridge.
port=4790
ogs dev --manifest "$work/ogs.manifest.json" --start-url "$origin/" --tv-url "$origin/" --port "$port" --phones 1 --lan 127.0.0.1 > "$work/dev.log" 2>&1 &
devpid=$!
for _ in $(seq 1 40); do curl -s -o /dev/null "http://localhost:$port/" && break; sleep 0.5; done
code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$port/")"
keys="$(curl -s "http://localhost:$port/.well-known/jwks.json" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).keys.length))')"
phone="$(curl -sL "http://localhost:$((port + 1))/" | grep -c 'ReactNativeWebView')"
[ "$code" = 200 ] && [ "$keys" = 1 ] && [ "$phone" -ge 1 ] && { pass=$((pass + 1)); echo "PASS dev (harness 200, jwks 1 key, phone page has the fake bridge)"; } || { fail=$((fail + 1)); echo "FAIL dev (harness $code, jwks $keys, bridge $phone)"; sed 's/^/     /' "$work/dev.log" | head -10; }
kill "$devpid" 2>/dev/null # TERM: a non-interactive shell's background jobs ignore SIGINT
wait "$devpid" 2>/dev/null

step "doctor" 1 ogs doctor
echo
echo "ogs e2e against $OGS_API: $pass passed, $fail failed"
rm -rf "$work"
[ "$fail" = 0 ]
