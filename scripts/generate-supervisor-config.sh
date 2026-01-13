#!/bin/bash
# Generates supervisord configuration from instances manifest and base template

set -e

MULTIPB_DATA_DIR="${MULTIPB_DATA_DIR:-/var/multipb/data}"
MANIFEST_PATH="$MULTIPB_DATA_DIR/instances.json"
SUPERVISOR_CONFIG="/etc/supervisord.conf"
SUPERVISOR_CONF_D="/etc/supervisor/conf.d"

# Create base supervisord.conf
cat > "$SUPERVISOR_CONFIG" << 'EOF'
[supervisord]
nodaemon=true
user=root
logfile=/var/log/supervisor/supervisord.log
pidfile=/var/run/supervisord.pid
loglevel=info
logfile_maxbytes=10MB
logfile_backups=3

[unix_http_server]
file=/var/run/supervisor.sock
chmod=0700

[supervisorctl]
serverurl=unix:///var/run/supervisor.sock

[rpcinterface:supervisor]
supervisor.rpcinterface_factory = supervisor.rpcinterface:make_main_rpcinterface

[include]
files = /etc/supervisor/conf.d/*.conf

# Caddy reverse proxy
[program:caddy]
command=/usr/sbin/caddy run --config /etc/caddy/Caddyfile
autostart=true
autorestart=true
startretries=3
stdout_logfile=/var/log/supervisor/caddy.log
stderr_logfile=/var/log/supervisor/caddy.err.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
stderr_logfile_maxbytes=10MB
stderr_logfile_backups=3
EOF

echo "✓ Base supervisord configuration generated"

# Clean up old instance configs
rm -f "$SUPERVISOR_CONF_D"/*.conf

# Generate config for each instance
if [ -f "$MANIFEST_PATH" ]; then
    instances=$(jq -r '.instances | to_entries[] | "\(.key) \(.value.port)"' "$MANIFEST_PATH" 2>/dev/null || echo "")
    
    if [ -n "$instances" ]; then
        while IFS=' ' read -r instance_name port; do
            [ -z "$instance_name" ] && continue
            
            instance_data_dir="$MULTIPB_DATA_DIR/$instance_name"
            mkdir -p "$instance_data_dir"
            
            # Create supervisor config for this instance
            cat > "$SUPERVISOR_CONF_D/pb-${instance_name}.conf" << EOF
[program:pb-${instance_name}]
command=/usr/local/bin/pocketbase serve --dir=${instance_data_dir} --http=127.0.0.1:${port}
autostart=true
autorestart=true
startretries=3
stdout_logfile=/var/log/supervisor/pb-${instance_name}.log
stderr_logfile=/var/log/supervisor/pb-${instance_name}.err.log
stdout_logfile_maxbytes=10MB
stdout_logfile_backups=3
stderr_logfile_maxbytes=10MB
stderr_logfile_backups=3
EOF
            echo "  ✓ Created config for instance: $instance_name (port $port)"
        done <<< "$instances"
    fi
fi

echo "✓ Supervisord configuration complete"
