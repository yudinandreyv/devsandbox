#!/usr/bin/env bash
set -euo pipefail

# Build and roll out both sandbox images with a date-based tag.
# Usage: scripts/deploy.sh [tag]   (default: current UTC date/time)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="${1:-$(date -u +%Y%m%d-%H%M)}"
REGISTRY="docker.io/library"
FRONTEND_IMAGE="${REGISTRY}/devsandbox-frontend:${TAG}"
API_IMAGE="${REGISTRY}/devsandbox-api:${TAG}"
MANIFEST="k8s/sandbox-stack.yaml"
SUDO="${SUDO:-sudo}"

echo "Deploying DevSandbox ${TAG}"

$SUDO docker build -t "$FRONTEND_IMAGE" ./frontend
$SUDO docker build -t "$API_IMAGE" ./backend

for image in "$FRONTEND_IMAGE" "$API_IMAGE"; do
  name="$(basename "${image%%:*}")"
  archive="/tmp/${name}-${TAG}.tar"
  $SUDO docker save "$image" -o "$archive"
  $SUDO k3s ctr images import "$archive"
done

sed -i -E "s#(image: devsandbox-frontend):[^ ]+#\1:${TAG}#" "$MANIFEST"
sed -i -E "s#(image: devsandbox-api):[^ ]+#\1:${TAG}#" "$MANIFEST"

$SUDO k3s kubectl apply -f "$MANIFEST"
$SUDO k3s kubectl -n sandbox rollout status deployment/frontend-sandbox --timeout=240s
$SUDO k3s kubectl -n sandbox rollout status deployment/api-sandbox --timeout=240s

echo "Deployed ${TAG}. Commit the updated ${MANIFEST} to keep Git in sync."
