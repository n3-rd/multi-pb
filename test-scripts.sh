#!/bin/bash
# Quick validation test for scripts

set -e

echo "Testing script syntax..."

# Check all scripts for syntax errors
for script in scripts/*.sh; do
    echo "  Checking $script..."
    bash -n "$script" || exit 1
done

echo "✓ All scripts have valid syntax"

# Test manifest manipulation
echo ""
echo "Testing manifest operations..."
TEMP_DIR=$(mktemp -d)
MANIFEST="$TEMP_DIR/instances.json"

# Initialize manifest
echo '{"instances":{}}' > "$MANIFEST"
echo "  Created manifest: $MANIFEST"

# Test adding an instance manually
jq '.instances["test1"] = {"port": 30000, "created_at": "2024-01-01T00:00:00Z"}' "$MANIFEST" > "$MANIFEST.tmp"
mv "$MANIFEST.tmp" "$MANIFEST"

# Test reading instances
INSTANCE_COUNT=$(jq '.instances | length' "$MANIFEST")
if [ "$INSTANCE_COUNT" -eq 1 ]; then
    echo "  ✓ Instance added successfully"
else
    echo "  ✗ Failed to add instance"
    exit 1
fi

# Test removing instance
jq 'del(.instances["test1"])' "$MANIFEST" > "$MANIFEST.tmp"
mv "$MANIFEST.tmp" "$MANIFEST"

INSTANCE_COUNT=$(jq '.instances | length' "$MANIFEST")
if [ "$INSTANCE_COUNT" -eq 0 ]; then
    echo "  ✓ Instance removed successfully"
else
    echo "  ✗ Failed to remove instance"
    exit 1
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "✓ All validations passed!"
echo ""
echo "Ready to build Docker image:"
echo "  docker build -t multipb ."
echo ""
echo "Then test with:"
echo "  docker run -d --name multipb-test -p 25983:25983 multipb"
echo "  docker exec multipb-test add-instance.sh test"
echo "  docker exec multipb-test list-instances.sh"
echo "  curl http://localhost:25983/_health"
echo "  curl http://localhost:25983/test/"
