#!/usr/bin/env bash
# Build the pinned baseline once for the owned engine and Docker rehearsals.
set -euo pipefail
out=$(mkdir -p "$1" && cd "$1" && pwd)
baseline=$(mktemp -d -t webadmin-baseline.XXXXXXXX)
trap 'rm -rf "$baseline"' EXIT
curl -fL --retry 3 -o "$out/oie.tar.gz" https://github.com/OpenIntegrationEngine/engine/releases/download/v4.6.0/oie_unix_4_6_0.tar.gz
curl -fL --retry 3 -o "$out/baseline.war" https://github.com/gibson9583/oie-web-client/releases/download/v0.9.0/oie-webadmin.war
python3 - "$out" <<'PY'
import hashlib, sys
from pathlib import Path
for name, expected in [('oie.tar.gz', '7c82e79027e671277e1d78d0f7bbb1c53ddf1be476f1e80c2ddbfcf7855900ea'),
                       ('baseline.war', 'f98a25c22504fc4f4e1fa9aeeff6ac601a23df11647ce0eddf5355f9ea31a6e6')]:
    with (Path(sys.argv[1]) / name).open('rb') as stream:
        assert hashlib.file_digest(stream, 'sha256').hexdigest() == expected, name
PY
git fetch --no-tags origin refs/tags/v0.9.0
baseline_sha=$(git rev-parse 'FETCH_HEAD^{commit}')
test "$baseline_sha" = ed684d26ef570ec4b29b7b7ff0c48d9972c2fe07
git archive "$baseline_sha" | tar -x -C "$baseline"
(
  cd "$baseline"
  npm ci
  BUILD_COMMIT="$baseline_sha" npm run build -w web-administrator
  npm prune --omit=dev
)
tar -czf "$out/baseline-node.tar.gz" -C "$baseline" \
  package.json package-lock.json packages node_modules web-administrator/package.json \
  web-administrator/build-info.json web-administrator/server web-administrator/client \
  web-administrator/plugins
python3 - "$out" "$baseline_sha" <<'PY'
import hashlib, json, sys
from pathlib import Path
root = Path(sys.argv[1])
hashes = {}
for name in ['oie.tar.gz', 'baseline.war', 'baseline-node.tar.gz']:
    with (root / name).open('rb') as stream:
        hashes[name] = hashlib.file_digest(stream, 'sha256').hexdigest()
(root / 'input-receipt.json').write_text(json.dumps({'baselineSourceSha': sys.argv[2], 'artifacts': hashes}, indent=2) + '\n')
PY
