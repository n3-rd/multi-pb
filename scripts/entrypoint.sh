#!/bin/bash
set -e

echo "╔══════════════════════════════════════════╗"
echo "║     Multi-PB Instance Manager            ║"
echo "╚══════════════════════════════════════════╝"

MULTIPB_PORT="${MULTIPB_PORT:-25983}"
MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"

# Create required directories
mkdir -p "$MULTIPB_DATA_DIR"
mkdir -p /etc/supervisor/conf.d
mkdir -p /var/log/supervisor

# Initialize instances manifest if it doesn't exist
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"
if [ ! -f "$MANIFEST_PATH" ]; then
    echo '{"instances":{}}' > "$MANIFEST_PATH"
    echo "✓ Initialized instances manifest"
fi

echo "Configuration:"
echo "  Port:      ${MULTIPB_PORT}"
echo "  Data Dir:  ${MULTIPB_DATA_DIR}"
echo ""

# Generate initial Caddy configuration
echo "Generating Caddy configuration..."
/var/multipb/scripts/generate-caddy-config.sh

# Generate supervisord configuration
echo "Generating supervisord configuration..."
/var/multipb/scripts/generate-supervisor-config.sh

# Start supervisord in foreground
echo "Starting supervisord..."
exec /usr/bin/supervisord -c /etc/supervisord.conf -n
