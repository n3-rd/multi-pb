#!/bin/bash
# Reloads Caddy reverse proxy configuration

set -e

echo "Reloading Caddy configuration..."

# Regenerate Caddy config
/var/multipb/scripts/generate-caddy-config.sh > /dev/null 2>&1

# Reload Caddy using the admin API
if curl -X POST http://localhost:2019/load \
    -H "Content-Type: application/json" \
    -d @/etc/caddy/Caddyfile \
    --max-time 5 > /dev/null 2>&1; then
    echo "✓ Caddy configuration reloaded successfully"
else
    # Fallback: try caddy reload command
    if caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile > /dev/null 2>&1; then
        echo "✓ Caddy configuration reloaded successfully"
    else
        echo "Warning: Caddy reload may have failed. Changes will apply on next restart."
    fi
fi
