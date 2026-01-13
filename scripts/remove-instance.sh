#!/bin/bash
# Removes a PocketBase instance

set -e

MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"

show_usage() {
    echo "Usage: remove-instance.sh <name> [--keep-data]"
    echo ""
    echo "Arguments:"
    echo "  <name>        Instance name to remove"
    echo "  --keep-data   Keep instance data directory (default: delete)"
    echo ""
    echo "Example:"
    echo "  remove-instance.sh myapp"
    echo "  remove-instance.sh myapp --keep-data"
    exit 1
}

INSTANCE_NAME=""
KEEP_DATA=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-data)
            KEEP_DATA=true
            shift
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

# Check if instance exists
if ! jq -e ".instances[\"$INSTANCE_NAME\"]" "$MANIFEST_PATH" > /dev/null 2>&1; then
    echo "Error: Instance '$INSTANCE_NAME' not found"
    exit 1
fi

echo "Removing instance '$INSTANCE_NAME'..."

# Stop the instance process
echo "  Stopping process..."
supervisorctl stop "pb-${INSTANCE_NAME}" > /dev/null 2>&1 || true

# Remove from supervisor
rm -f "/etc/supervisor/conf.d/pb-${INSTANCE_NAME}.conf"

# Update manifest
echo "  Updating manifest..."
TMP_MANIFEST=$(mktemp)
jq "del(.instances[\"$INSTANCE_NAME\"])" "$MANIFEST_PATH" > "$TMP_MANIFEST"
mv "$TMP_MANIFEST" "$MANIFEST_PATH"

# Optionally remove data
if [ "$KEEP_DATA" = false ]; then
    INSTANCE_DATA_DIR="$MULTIPB_DATA_DIR/$INSTANCE_NAME"
    if [ -d "$INSTANCE_DATA_DIR" ]; then
        echo "  Removing data directory..."
        rm -rf "$INSTANCE_DATA_DIR"
    fi
else
    echo "  Keeping data directory"
fi

# Regenerate configurations
echo "  Regenerating configurations..."
/var/multipb/scripts/generate-caddy-config.sh > /dev/null 2>&1
/var/multipb/scripts/generate-supervisor-config.sh > /dev/null 2>&1

# Reload supervisord
supervisorctl reread > /dev/null 2>&1 || true
supervisorctl update > /dev/null 2>&1 || true

# Reload Caddy
echo "  Reloading reverse proxy..."
/var/multipb/scripts/reload-proxy.sh > /dev/null 2>&1 || echo "  Note: Proxy will reload on next request"

echo ""
echo "✓ Instance '$INSTANCE_NAME' removed successfully!"
