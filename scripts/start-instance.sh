#!/bin/bash
# Starts a PocketBase instance

set -e

MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"

show_usage() {
    echo "Usage: start-instance.sh <name>"
    echo ""
    echo "Arguments:"
    echo "  <name>    Instance name to start"
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

echo "Starting instance '$INSTANCE_NAME'..."

# Start via supervisorctl
if supervisorctl start "pb-${INSTANCE_NAME}" > /dev/null 2>&1; then
    echo "✓ Instance '$INSTANCE_NAME' started successfully"
else
    echo "Error: Failed to start instance '$INSTANCE_NAME'"
    supervisorctl status "pb-${INSTANCE_NAME}"
    exit 1
fi
