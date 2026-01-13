#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════╗"
echo "║          Multi-PB Installer              ║"
echo "║   Multi-Instance PocketBase Manager      ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Check for required commands
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}Error: $1 is not installed.${NC}"
        echo "Please install $1 and try again."
        exit 1
    fi
}

echo -e "${YELLOW}Checking requirements...${NC}"
check_command docker
check_command curl

# Check if docker compose is available (v2 or v1)
if docker compose version &> /dev/null; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE="docker-compose"
else
    echo -e "${RED}Error: Docker Compose is not installed.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ All requirements met${NC}"
echo ""

# Default values
DEFAULT_PORT="25983"
DEFAULT_DATA_DIR="./multipb-data"

# Prompt for configuration
echo -e "${BLUE}Configuration${NC}"
echo "Press Enter to accept defaults shown in [brackets]"
echo ""

read -p "External port [$DEFAULT_PORT]: " MULTIPB_PORT
MULTIPB_PORT="${MULTIPB_PORT:-$DEFAULT_PORT}"

read -p "Data directory [$DEFAULT_DATA_DIR]: " DATA_DIR
DATA_DIR="${DATA_DIR:-$DEFAULT_DATA_DIR}"

# Create installation directory
INSTALL_DIR="${DATA_DIR}"
mkdir -p "$INSTALL_DIR"

# Determine script location to find source files
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_FROM_SOURCE="false"

# Check if running from source (Dockerfile exists next to this script)
if [ -f "${SCRIPT_DIR}/Dockerfile" ]; then
    BUILD_FROM_SOURCE="true"
fi

echo ""
echo -e "${YELLOW}Creating configuration...${NC}"

# Generate docker-compose.yml
if [ "$BUILD_FROM_SOURCE" = "true" ]; then
cat > "$INSTALL_DIR/docker-compose.yml" << EOF
services:
  multipb:
    build: ${SCRIPT_DIR}
    container_name: multipb
    restart: unless-stopped
    ports:
      - "${MULTIPB_PORT}:${MULTIPB_PORT}"
    volumes:
      - ./data:/var/multipb/data
    environment:
      - MULTIPB_PORT=${MULTIPB_PORT}
      - MULTIPB_DATA_DIR=/var/multipb/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${MULTIPB_PORT}/_health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  multipb-data:
EOF
else
cat > "$INSTALL_DIR/docker-compose.yml" << EOF
services:
  multipb:
    image: ghcr.io/n3-rd/multi-pb:latest
    container_name: multipb
    restart: unless-stopped
    ports:
      - "${MULTIPB_PORT}:${MULTIPB_PORT}"
    volumes:
      - ./data:/var/multipb/data
    environment:
      - MULTIPB_PORT=${MULTIPB_PORT}
      - MULTIPB_DATA_DIR=/var/multipb/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:${MULTIPB_PORT}/_health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  multipb-data:
EOF
fi

# Create data directory
mkdir -p "$INSTALL_DIR/data"

echo -e "${GREEN}✓ Configuration created${NC}"
echo ""

# Summary
echo -e "${BLUE}Installation Summary${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  Port:       ${GREEN}${MULTIPB_PORT}${NC}"
echo -e "  Access:     ${GREEN}http://localhost:${MULTIPB_PORT}/_health${NC}"
echo -e "  Data Dir:   ${GREEN}${INSTALL_DIR}/data${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Ask to start
read -p "Start Multi-PB now? (Y/n): " START_NOW
if [[ ! "$START_NOW" =~ ^[Nn]$ ]]; then
    echo ""
    echo -e "${YELLOW}Starting Multi-PB...${NC}"
    cd "$INSTALL_DIR"
    
    $DOCKER_COMPOSE up -d --build
    
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         Multi-PB is running!             ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "Next steps:"
    echo -e "  1. Create your first instance:"
    echo -e "     ${BLUE}docker exec multipb add-instance.sh myapp${NC}"
    echo ""
    echo -e "  2. Access it at:"
    echo -e "     ${BLUE}http://localhost:${MULTIPB_PORT}/myapp/${NC}"
    echo ""
    echo -e "  3. List all instances:"
    echo -e "     ${BLUE}docker exec multipb list-instances.sh${NC}"
    echo ""
    echo -e "  4. Manage instances:"
    echo -e "     ${BLUE}docker exec multipb add-instance.sh <name>${NC}"
    echo -e "     ${BLUE}docker exec multipb remove-instance.sh <name>${NC}"
    echo -e "     ${BLUE}docker exec multipb start-instance.sh <name>${NC}"
    echo -e "     ${BLUE}docker exec multipb stop-instance.sh <name>${NC}"
    echo ""
else
    echo ""
    echo -e "To start later, run:"
    echo -e "  ${BLUE}cd ${INSTALL_DIR} && ${DOCKER_COMPOSE} up -d${NC}"
fi

echo ""
echo -e "${GREEN}Installation complete!${NC}"
