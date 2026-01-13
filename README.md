# Multi-PB

A single-container solution to run and manage hundreds of PocketBase instances without host-level port conflicts. All instances are accessible through one configurable port using path-based routing.

## Quick Start

### One-Command Install

```bash
curl -fsSL https://raw.githubusercontent.com/n3-rd/multi-pb/main/install.sh | bash
```

Or clone and run locally:

```bash
git clone https://github.com/n3-rd/multi-pb.git
cd multi-pb
./install.sh
```

### Manual Setup

```bash
# Build and run
docker build -t multipb .
docker run -d --name multipb \
  -p 25983:25983 \
  -v multipb-data:/var/multipb/data \
  multipb

# Create your first instance
docker exec multipb add-instance.sh myapp

# Access it
open http://localhost:25983/myapp/
```

## Features

- **Single Port Exposure** - Only one configurable external port (default: 25983)
- **Path-Based Routing** - Access instances via `/{instance}/` with no DNS setup required
- **No Port Conflicts** - Hundreds of instances using internal ephemeral ports (30000-39999)
- **Simple CLI** - Easy instance management with shell scripts
- **Automatic Routing** - Reverse proxy configuration updates automatically
- **Persistent Data** - Single volume mount preserves all instances
- **Health Checks** - Built-in container and per-instance monitoring

## Architecture

```
┌─────────────────────────────────────────────┐
│               Docker Host                   │
│  ┌───────────────────────────────────────┐  │
│  │     Multi-PB Container (Alpine)       │  │
│  │  ┌─────────────────────────────────┐  │  │
│  │  │   Caddy (Port 25983)            │  │  │
│  │  │   /_health, /_instances         │  │  │
│  │  └──────────────┬──────────────────┘  │  │
│  │                 │ Path routing        │  │
│  │  ┌──────┬───────┴───────┬──────┐     │  │
│  │  │      │               │      │     │  │
│  │  ▼      ▼               ▼      ▼     │  │
│  │ /app/  /db/           /api/  /web/   │  │
│  │ :30000 :30001        :30002  :30003  │  │
│  │  PB-1   PB-2          PB-3    PB-4   │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MULTIPB_PORT` | `25983` | External port for all instances |
| `MULTIPB_DATA_DIR` | `/var/multipb/data` | Data directory inside container |

### Docker Compose

```yaml
services:
  multipb:
    image: ghcr.io/n3-rd/multi-pb:latest
    container_name: multipb
    restart: unless-stopped
    ports:
      - "25983:25983"
    volumes:
      - multipb-data:/var/multipb/data
    environment:
      - MULTIPB_PORT=25983
```

## Instance Management

### Create Instance

```bash
docker exec multipb add-instance.sh myapp
# With admin credentials (optional)
docker exec multipb add-instance.sh myapp --email admin@example.com --password secret123
```

Access at: `http://localhost:25983/myapp/`
Admin UI: `http://localhost:25983/myapp/_/`

### List Instances

```bash
docker exec multipb list-instances.sh
```

### Start/Stop Instance

```bash
docker exec multipb stop-instance.sh myapp
docker exec multipb start-instance.sh myapp
```

### Remove Instance

```bash
# Remove instance but keep data
docker exec multipb remove-instance.sh myapp --keep-data

# Remove instance and data
docker exec multipb remove-instance.sh myapp
```

## Production Deployment

### Behind External Reverse Proxy

If using Traefik, nginx, or Caddy upstream, expose the container port locally:

```yaml
ports:
  - "127.0.0.1:25983:25983"  # Only accessible locally
```

Then configure your external proxy:

**Nginx:**
```nginx
location /pocketbase/ {
    proxy_pass http://localhost:25983/;
}
```

**Traefik:**
```yaml
http:
  routers:
    multipb:
      rule: "PathPrefix(`/pocketbase/`)"
      service: multipb
  services:
    multipb:
      loadBalancer:
        servers:
          - url: "http://localhost:25983"
```

**Caddy:**
```
example.com {
    handle /pocketbase/* {
        reverse_proxy localhost:25983
    }
}
```

### Subdomain Routing (Advanced)

For subdomain-based routing (e.g., `myapp.pb.example.com`), configure your external reverse proxy to route based on subdomain and rewrite paths to the instance name format.

**Nginx example:**
```nginx
server {
    server_name ~^(?<instance>.+)\.pb\.example\.com$;
    location / {
        proxy_pass http://localhost:25983/$instance/;
    }
}
```

## Health & Monitoring

### Health Check Endpoint

```bash
curl http://localhost:25983/_health
# Returns: OK
```

### Instance List Endpoint

```bash
curl http://localhost:25983/_instances
# Returns: {"status":"ok","data_dir":"/var/multipb/data"}
```

### Check Instance Status

```bash
docker exec multipb supervisorctl status
```

## Backup & Restore

### Backup All Instances

```bash
docker run --rm -v multipb-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/multipb-backup-$(date +%Y%m%d).tar.gz /data
```

### Restore

```bash
docker run --rm -v multipb-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/multipb-backup-YYYYMMDD.tar.gz -C /
```

## Troubleshooting

### View Container Logs

```bash
docker logs -f multipb
```

### View Instance Logs

```bash
docker exec multipb tail -f /var/log/supervisor/pb-myapp.log
```

### View All Process Status

```bash
docker exec multipb supervisorctl status
```

### Reload Proxy Configuration

```bash
docker exec multipb reload-proxy.sh
```

### Container Won't Start

- Check logs: `docker logs multipb`
- Verify port availability: `netstat -tulpn | grep 25983`
- Check volume mount: `docker volume inspect multipb-data`

### Instance Not Accessible

- List instances: `docker exec multipb list-instances.sh`
- Check status: `docker exec multipb supervisorctl status pb-myapp`
- Verify routing: `curl http://localhost:25983/_health`

## Development

```bash
# Clone
git clone https://github.com/n3-rd/multi-pb.git
cd multi-pb

# Build and run
docker compose up -d --build

# View logs
docker logs -f multipb

# Test instance creation
docker exec multipb add-instance.sh testapp
curl http://localhost:25983/testapp/
```

### Project Structure

```
multi-pb/
├── Dockerfile                  # Container build
├── docker-compose.yml          # Compose configuration
├── scripts/
│   ├── entrypoint.sh          # Container initialization
│   ├── add-instance.sh        # Create instance
│   ├── remove-instance.sh     # Remove instance
│   ├── list-instances.sh      # List all instances
│   ├── start-instance.sh      # Start instance
│   ├── stop-instance.sh       # Stop instance
│   ├── reload-proxy.sh        # Reload Caddy
│   ├── generate-caddy-config.sh
│   └── generate-supervisor-config.sh
├── templates/
│   ├── Caddyfile.template
│   ├── supervisord.conf.template
│   └── instance.conf.template
└── README.md
```

## Performance & Limits

- **Max Instances**: ~10,000 (limited by port range 30000-39999)
- **Recommended**: < 100 instances per container for optimal performance
- **Memory**: ~50MB per idle PocketBase instance
- **CPU**: Minimal when idle, scales with request load

## Security Considerations

- Each instance runs in isolated process with separate data directory
- No inter-instance communication by default
- Internal ports (30000-39999) not exposed to host
- Health endpoints public but contain minimal information
- Use external reverse proxy with SSL for production

## Comparison: Old vs New

| Feature | Old (Subdomain) | New (Path-based) |
|---------|----------------|------------------|
| Ports exposed | 3 (80, 443, 8080) | 1 (25983) |
| DNS required | Yes (wildcard) | No |
| Routing | Subdomain-based | Path-based |
| Management | Web dashboard + API | Simple CLI scripts |
| Dependencies | Go, Node.js, Caddy | Bash, Caddy, supervisord |
| Image size | ~200MB | ~80MB |
| Complexity | High | Low |

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.
