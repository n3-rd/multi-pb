#!/bin/bash
# Adds a new PocketBase instance

set -e

MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"

# Parse arguments
INSTANCE_NAME=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""

show_usage() {
    echo "Usage: add-instance.sh <name> [--email <admin_email>] [--password <admin_password>]"
    echo ""
    echo "Arguments:"
    echo "  <name>              Instance name (alphanumeric, hyphens, underscores)"
    echo "  --email             Admin email for PocketBase (optional)"
    echo "  --password          Admin password for PocketBase (optional)"
    echo ""
    echo "Example:"
    echo "  add-instance.sh myapp --email admin@example.com --password secret123"
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --email)
            ADMIN_EMAIL="$2"
            shift 2
            ;;
        --password)
            ADMIN_PASSWORD="$2"
            shift 2
            ;;
        -h|--help)
            show_usage
            ;;
        *)
            if [ -z "$INSTANCE_NAME" ]; then
                INSTANCE_NAME="$1"
            else
                echo "Error: Unknown argument: $1"
                show_usage
            fi
            shift
            ;;
    esac
done

if [ -z "$INSTANCE_NAME" ]; then
    echo "Error: Instance name is required"
    show_usage
fi

# Validate instance name
if ! echo "$INSTANCE_NAME" | grep -qE '^[a-zA-Z0-9_-]+$'; then
    echo "Error: Instance name must contain only alphanumeric characters, hyphens, and underscores"
    exit 1
fi

# Check if instance already exists
if jq -e ".instances[\"$INSTANCE_NAME\"]" "$MANIFEST_PATH" > /dev/null 2>&1; then
    echo "Error: Instance '$INSTANCE_NAME' already exists"
    exit 1
fi

# Find next available port
# Start from 30000 and find the first unused port
START_PORT=30000
MAX_PORT=39999

# Get all used ports sorted
USED_PORTS=$(jq -r '.instances[] | .port' "$MANIFEST_PATH" 2>/dev/null | sort -n || echo "")

# Find first available port
NEXT_PORT=$START_PORT
if [ -n "$USED_PORTS" ]; then
    # Check each potential port starting from START_PORT
    while [ "$NEXT_PORT" -le "$MAX_PORT" ]; do
        # Check if this port is in use
        if echo "$USED_PORTS" | grep -q "^${NEXT_PORT}$"; then
            # Port is in use, try next
            NEXT_PORT=$((NEXT_PORT + 1))
        else
            # Found available port
            break
        fi
    done
fi

if [ "$NEXT_PORT" -gt "$MAX_PORT" ]; then
    echo "Error: No available ports (max instances reached)"
    exit 1
fi

# Create instance data directory
INSTANCE_DATA_DIR="$MULTIPB_DATA_DIR/$INSTANCE_NAME"
mkdir -p "$INSTANCE_DATA_DIR"

echo "Creating instance '$INSTANCE_NAME'..."
echo "  Port: $NEXT_PORT"
echo "  Data directory: $INSTANCE_DATA_DIR"

# Update manifest
TMP_MANIFEST=$(mktemp)
jq ".instances[\"$INSTANCE_NAME\"] = {\"port\": $NEXT_PORT, \"created_at\": \"$(date -Iseconds)\"}" "$MANIFEST_PATH" > "$TMP_MANIFEST"
mv "$TMP_MANIFEST" "$MANIFEST_PATH"

# Regenerate configurations
echo "Regenerating configurations..."
/var/multipb/scripts/generate-caddy-config.sh > /dev/null 2>&1
/var/multipb/scripts/generate-supervisor-config.sh > /dev/null 2>&1

# Reload supervisord to pick up new instance
echo "Starting instance..."
supervisorctl reread > /dev/null 2>&1 || true
supervisorctl update > /dev/null 2>&1 || true
supervisorctl start "pb-${INSTANCE_NAME}" > /dev/null 2>&1 || true

# Reload Caddy using the proper method
echo "Reloading reverse proxy..."
/var/multipb/scripts/reload-proxy.sh > /dev/null 2>&1 || echo "  Note: Proxy will reload on next request"

# Wait a moment for instance to start
sleep 2

MULTIPB_PORT="${MULTIPB_PORT:-25983}"
echo ""
echo "✓ Instance '$INSTANCE_NAME' created successfully!"
echo ""
echo "Access your instance at:"
echo "  http://localhost:${MULTIPB_PORT}/${INSTANCE_NAME}/"
echo ""
echo "PocketBase admin UI:"
echo "  http://localhost:${MULTIPB_PORT}/${INSTANCE_NAME}/_/"
echo ""

if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    echo "Note: Admin credentials provided. You can set them up on first access."
    echo "      (Automatic admin creation requires PocketBase API calls)"
fi
