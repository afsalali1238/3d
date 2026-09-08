#!/usr/bin/env bash
# Draco-compress the body GLBs in place.
#
# Use after scripts/build_body_asset.py for the compact base meshes, or after
# scripts/enhance_body_realism.mjs for the high-detail runtime meshes. The
# viewer's GLTFLoader already has DRACOLoader wired (decoders self-hosted in
# /public/decoders), and _REGIONID survives quantization with <0.01 drift so
# picker rounding remains stable.
set -euo pipefail
cd "$(dirname "$0")/.."
for g in male female; do
  npx --yes gltf-transform draco "public/models/body-$g.glb" "public/models/body-$g.glb" \
    --method edgebreaker --encode-speed 5 --decode-speed 5
done
cp public/models/body-male.glb public/models/body.glb
ls -la public/models/*.glb
