#!/bin/sh
# Generates a self-signed TLS cert for the dev nginx if none exists.
# Production deployments should mount a real cert into /etc/nginx/certs/.
set -e

CERT_DIR=/etc/nginx/certs
CERT="$CERT_DIR/server.crt"
KEY="$CERT_DIR/server.key"

mkdir -p "$CERT_DIR"

if [ -f "$CERT" ] && [ -f "$KEY" ]; then
    echo "[gen-cert] existing cert found, leaving alone"
    exit 0
fi

echo "[gen-cert] generating self-signed cert for localhost (dev only)"
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
    -keyout "$KEY" -out "$CERT" \
    -subj "/CN=looking-glass-dev" \
    -addext "subjectAltName=DNS:localhost,DNS:nginx,IP:127.0.0.1"

chmod 600 "$KEY"
echo "[gen-cert] done"
