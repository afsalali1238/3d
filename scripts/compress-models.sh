#!/usr/bin/env bash
# Draco-compress the body GLBs in place. Run after scripts/build_body_asset.py.
#
# The viewer's GLTFLoader already has DRACOLoader wired (decoders self-hosted
# in /public/decoders), and the _REGIONID channel survives quantization
# integer-exact (verified: 81/81 region ids, zero off-integer drift).
# Result: ~634 KB -> ~80 KB per body.
set -euo pipefail
cd "$(dirname "$0")/.."
for g in male female; do
  npx --yes gltf-transform draco "public/models/body-$g.glb" "public/models/body-$g.glb"
done
ls -la public/models/*.glb
