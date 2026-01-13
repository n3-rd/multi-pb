#!/bin/bash
# Reloads Caddy reverse proxy configuration

set -e

echo "Reloading Caddy configuration..."

# Regenerate Caddy config
/var/multipb/scripts/generate-caddy-config.sh > /dev/null 2>&1

# Send HUP signal to Caddy via supervisorctl
if supervisorctl signal HUP caddy > /dev/null 2>&1; then
    echo "✓ Caddy configuration reloaded successfully"
else
    echo "Error: Failed to reload Caddy"
    exit 1
fi
