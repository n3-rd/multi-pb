#!/bin/bash
# Generates Caddy configuration from instances manifest

set -e

MULTIPB_PORT="${MULTIPB_PORT:-25983}"
MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"
CADDY_CONFIG="/etc/caddy/Caddyfile"

# Ensure Caddy directory exists
mkdir -p /etc/caddy

# Start Caddyfile
cat > "$CADDY_CONFIG" << 'EOF'
{
    auto_https off
    admin off
}

:${MULTIPB_PORT} {
    # Health check endpoint
    handle /_health {
        respond "OK" 200
    }

    # Instance list endpoint
    handle /_instances {
        root * ${MULTIPB_DATA_DIR}
        file_server browse {
            hide instances.json
        }
        header Content-Type application/json
        respond `{"status":"ok","data_dir":"${MULTIPB_DATA_DIR}"}`
    }

EOF

# Add routes for each instance from manifest
if [ -f "$MANIFEST_PATH" ]; then
    # Use jq to parse JSON and extract instance routes
    instances=$(jq -r '.instances | to_entries[] | "\(.key) \(.value.port)"' "$MANIFEST_PATH" 2>/dev/null || echo "")
    
    if [ -n "$instances" ]; then
        while IFS=' ' read -r instance_name port; do
            [ -z "$instance_name" ] && continue
            cat >> "$CADDY_CONFIG" << EOF
    # Instance: $instance_name
    handle /${instance_name}/* {
        uri strip_prefix /${instance_name}
        reverse_proxy localhost:${port}
    }

EOF
        done <<< "$instances"
    fi
fi

# Close the server block
echo "}" >> "$CADDY_CONFIG"

echo "✓ Caddy configuration generated at $CADDY_CONFIG"
