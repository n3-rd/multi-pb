#!/bin/bash
# Stops a PocketBase instance

set -e

MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"

show_usage() {
    echo "Usage: stop-instance.sh <name>"
    echo ""
    echo "Arguments:"
    echo "  <name>    Instance name to stop"
    exit 1
}

INSTANCE_NAME="$1"

if [ -z "$INSTANCE_NAME" ]; then
    echo "Error: Instance name is required"
    show_usage
fi

# Check if instance exists
if ! jq -e ".instances[\"$INSTANCE_NAME\"]" "$MANIFEST_PATH" > /dev/null 2>&1; then
    echo "Error: Instance '$INSTANCE_NAME' not found"
    exit 1
fi

echo "Stopping instance '$INSTANCE_NAME'..."

# Stop via supervisorctl
if supervisorctl stop "pb-${INSTANCE_NAME}" > /dev/null 2>&1; then
    echo "✓ Instance '$INSTANCE_NAME' stopped successfully"
else
    echo "Warning: Instance '$INSTANCE_NAME' may not have been running"
fi
