# Multi-stage build for PocketBase Multi-Instance Container
FROM alpine:latest

# Install runtime dependencies
# Install from edge/testing for supervisor
RUN apk add --no-cache \
    ca-certificates \
    curl \
    bash \
    unzip \
    jq \
    --repository=http://dl-cdn.alpinelinux.org/alpine/edge/main && \
    apk add --no-cache \
    supervisor \
    --repository=http://dl-cdn.alpinelinux.org/alpine/edge/testing

# Install Caddy
RUN apk add --no-cache caddy --repository=http://dl-cdn.alpinelinux.org/alpine/edge/community

# Download PocketBase binary (detect architecture)
ARG PB_VERSION=0.23.4
RUN ARCH=$(uname -m) && \
    case "$ARCH" in \
        x86_64) ARCH_NAME="amd64" ;; \
        aarch64) ARCH_NAME="arm64" ;; \
        armv7l) ARCH_NAME="armv7" ;; \
        *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
    esac && \
    echo "Downloading PocketBase for $ARCH_NAME..." && \
    curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${ARCH_NAME}.zip" \
    -o /tmp/pocketbase.zip && \
    unzip /tmp/pocketbase.zip -d /tmp && \
    mv /tmp/pocketbase /usr/local/bin/pocketbase && \
    chmod +x /usr/local/bin/pocketbase && \
    rm -rf /tmp/*

# Create application directories
RUN mkdir -p /var/multipb/data \
    /var/multipb/scripts \
    /var/log/supervisor \
    /etc/supervisor/conf.d

# Copy management scripts
COPY scripts/entrypoint.sh /var/multipb/scripts/
COPY scripts/add-instance.sh /var/multipb/scripts/
COPY scripts/remove-instance.sh /var/multipb/scripts/
COPY scripts/list-instances.sh /var/multipb/scripts/
COPY scripts/start-instance.sh /var/multipb/scripts/
COPY scripts/stop-instance.sh /var/multipb/scripts/
COPY scripts/reload-proxy.sh /var/multipb/scripts/
COPY scripts/generate-caddy-config.sh /var/multipb/scripts/
COPY scripts/generate-supervisor-config.sh /var/multipb/scripts/

# Make scripts executable
RUN chmod +x /var/multipb/scripts/*.sh

# Copy configuration templates
COPY templates/Caddyfile.template /var/multipb/templates/
COPY templates/supervisord.conf.template /var/multipb/templates/
COPY templates/instance.conf.template /var/multipb/templates/

# Create symlinks for easy access
RUN ln -s /var/multipb/scripts/add-instance.sh /usr/local/bin/add-instance.sh && \
    ln -s /var/multipb/scripts/remove-instance.sh /usr/local/bin/remove-instance.sh && \
    ln -s /var/multipb/scripts/list-instances.sh /usr/local/bin/list-instances.sh && \
    ln -s /var/multipb/scripts/start-instance.sh /usr/local/bin/start-instance.sh && \
    ln -s /var/multipb/scripts/stop-instance.sh /usr/local/bin/stop-instance.sh

# Environment defaults
ENV MULTIPB_PORT=25983 \
    MULTIPB_DATA_DIR=/var/multipb/data

# Expose only the single external port
EXPOSE ${MULTIPB_PORT}

# Health check - ping internal health endpoint
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${MULTIPB_PORT}/_health || exit 1

WORKDIR /var/multipb

ENTRYPOINT ["/var/multipb/scripts/entrypoint.sh"]
