#!/bin/bash
# Lists all PocketBase instances

set -e

MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"
MULTIPB_PORT="${MULTIPB_PORT:-25983}"
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"

if [ ! -f "$MANIFEST_PATH" ]; then
    echo "No instances found"
    exit 0
fi

# Check if there are any instances
INSTANCE_COUNT=$(jq '.instances | length' "$MANIFEST_PATH" 2>/dev/null || echo "0")

if [ "$INSTANCE_COUNT" -eq 0 ]; then
    echo "No instances found"
    exit 0
fi

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                   PocketBase Instances                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
printf "%-20s %-10s %-10s %-30s\n" "NAME" "PORT" "STATUS" "URL"
echo "────────────────────────────────────────────────────────────────"

# Iterate over instances
jq -r '.instances | to_entries[] | "\(.key) \(.value.port)"' "$MANIFEST_PATH" | while IFS=' ' read -r instance_name port; do
    # Check if process is running via supervisor
    STATUS="stopped"
    if supervisorctl status "pb-${instance_name}" 2>/dev/null | grep -q "RUNNING"; then
        STATUS="running"
    elif supervisorctl status "pb-${instance_name}" 2>/dev/null | grep -q "STARTING"; then
        STATUS="starting"
    elif supervisorctl status "pb-${instance_name}" 2>/dev/null | grep -q "FATAL"; then
        STATUS="error"
    fi
    
    URL="http://localhost:${MULTIPB_PORT}/${instance_name}/"
    
    printf "%-20s %-10s %-10s %-30s\n" "$instance_name" "$port" "$STATUS" "$URL"
done

echo ""
echo "Total instances: $INSTANCE_COUNT"
echo ""
echo "Commands:"
echo "  docker exec <container> add-instance.sh <name>"
echo "  docker exec <container> remove-instance.sh <name>"
echo "  docker exec <container> start-instance.sh <name>"
echo "  docker exec <container> stop-instance.sh <name>"
