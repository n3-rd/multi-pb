# Production Deployment Guide

## Overview

Multi-PB is designed for production use with a single-container, single-port architecture that simplifies deployment and eliminates port conflicts.

## Production-Ready Features

✅ **Single Port Exposure** - Only one configurable port (default: 25983)  
✅ **Path-Based Routing** - No DNS requirements for basic operation  
✅ **Process Supervision** - supervisord manages all PocketBase processes  
✅ **Auto-Restart** - Failed instances automatically restart  
✅ **Health Checks** - Built-in container health monitoring  
✅ **Log Rotation** - 10MB logs with 3 backups per process  
✅ **Persistent Storage** - Single volume mount for all data  
✅ **Zero Downtime Updates** - Instances managed independently  

## Quick Production Setup

### 1. Install on VPS

```bash
curl -fsSL https://raw.githubusercontent.com/n3-rd/multi-pb/main/install.sh | bash
```

### 2. Configure Port

Default port 25983 is intentionally obscure. For custom port:

```bash
# Edit .env
MULTIPB_PORT=25983

# Or pass during installation
MULTIPB_PORT=12345 ./install.sh
```

### 3. Start Container

```bash
docker compose up -d
```

### 4. Create Instances

```bash
docker exec multipb add-instance.sh production
docker exec multipb add-instance.sh staging
docker exec multipb add-instance.sh testing
```

## Deployment Strategies

### Strategy 1: Direct Access (Simplest)

Expose Multi-PB directly on an obscure port:

```yaml
services:
  multipb:
    ports:
      - "25983:25983"
```

Access: `http://your-server:25983/{instance}/`

**Pros:**
- Simplest setup
- No additional components
- Fast to deploy

**Cons:**
- No SSL by default
- Port must be open on firewall

### Strategy 2: Behind Reverse Proxy (Recommended)

Use nginx, Caddy, or Traefik for SSL and friendly URLs:

```yaml
services:
  multipb:
    ports:
      - "127.0.0.1:25983:25983"  # Local only
```

**Nginx Configuration:**

```nginx
server {
    listen 443 ssl http2;
    server_name pb.example.com;
    
    ssl_certificate /etc/letsencrypt/live/pb.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pb.example.com/privkey.pem;
    
    location / {
        proxy_pass http://localhost:25983;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Caddy Configuration:**

```caddyfile
pb.example.com {
    reverse_proxy localhost:25983
}
```

Access: `https://pb.example.com/{instance}/`

**Pros:**
- Automatic SSL with Let's Encrypt
- Friendly domain names
- Additional security layer
- Request logging

**Cons:**
- Requires domain name
- Additional component to manage

### Strategy 3: Subdomain Routing (Advanced)

External proxy routes subdomains to path-based instances:

**Nginx:**

```nginx
server {
    listen 443 ssl http2;
    server_name ~^(?<instance>.+)\.pb\.example\.com$;
    
    location / {
        proxy_pass http://localhost:25983/$instance/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Caddy:**

```caddyfile
*.pb.example.com {
    @subdomain {
        host {labels.3}.pb.example.com
    }
    handle @subdomain {
        reverse_proxy localhost:25983/{labels.3}/
    }
}
```

DNS: Wildcard record `*.pb.example.com A <ip>`

Access: `https://myapp.pb.example.com/`

**Pros:**
- Clean URLs without path prefix
- Isolated-looking instances

**Cons:**
- Requires wildcard DNS
- More complex proxy config
- More complex to debug

## Security Hardening

### 1. Firewall Configuration

```bash
# Allow only necessary ports
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # HTTP (for SSL challenges)
ufw allow 443/tcp     # HTTPS
ufw enable

# Multi-PB port should be blocked if behind proxy
# ufw deny 25983/tcp
```

### 2. Container Security

```yaml
services:
  multipb:
    # Drop unnecessary capabilities
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE
    
    # Read-only root filesystem (if possible)
    # read_only: true
    
    # Security options
    security_opt:
      - no-new-privileges:true
```

### 3. Resource Limits

```yaml
services:
  multipb:
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 512M
```

### 4. Regular Updates

```bash
# Update Multi-PB
docker pull ghcr.io/n3-rd/multi-pb:latest
docker compose up -d

# Update system packages
apt update && apt upgrade -y
```

## Backup Strategy

### Automated Backups

```bash
#!/bin/bash
# /usr/local/bin/backup-multipb.sh

BACKUP_DIR="/backups/multipb"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

docker run --rm \
  -v multipb-data:/data:ro \
  -v "$BACKUP_DIR":/backup \
  alpine \
  tar czf "/backup/multipb-${DATE}.tar.gz" /data

# Keep only last 7 days
find "$BACKUP_DIR" -name "multipb-*.tar.gz" -mtime +7 -delete

echo "Backup completed: multipb-${DATE}.tar.gz"
```

**Add to crontab:**

```bash
# Daily backup at 2 AM
0 2 * * * /usr/local/bin/backup-multipb.sh >> /var/log/multipb-backup.log 2>&1
```

### Manual Backup

```bash
# Create backup
docker run --rm \
  -v multipb-data:/data:ro \
  -v $(pwd):/backup \
  alpine \
  tar czf /backup/multipb-backup.tar.gz /data

# Restore backup
docker run --rm \
  -v multipb-data:/data \
  -v $(pwd):/backup \
  alpine \
  tar xzf /backup/multipb-backup.tar.gz -C /
```

### Incremental Backups with rsync

```bash
# Backup to remote server
rsync -avz --delete \
  /var/lib/docker/volumes/multipb-data/_data/ \
  backup-server:/backups/multipb/
```

## Monitoring

### Container Health

```bash
# Check health status
docker ps | grep multipb

# View health check logs
docker inspect multipb | jq '.[0].State.Health'
```

### Process Monitoring

```bash
# All processes
docker exec multipb supervisorctl status

# Specific instance
docker exec multipb supervisorctl status pb-myapp

# Tail logs
docker exec multipb supervisorctl tail -f pb-myapp
```

### Log Management

```bash
# View all logs
docker logs -f multipb

# View instance logs
docker exec multipb tail -f /var/log/supervisor/pb-myapp.log

# View Caddy logs
docker exec multipb tail -f /var/log/supervisor/caddy.log
```

### Prometheus Monitoring (Optional)

Install Prometheus PocketBase exporter for metrics:

```yaml
services:
  pb-exporter:
    image: pocketbase-exporter:latest
    depends_on:
      - multipb
    environment:
      - POCKETBASE_URLS=http://multipb:25983/app1/,http://multipb:25983/app2/
```

## Performance Tuning

### Instance Limits

**Recommended:**
- Development: 10-20 instances
- Production: 50-100 instances
- High-performance: 100-200 instances

**Max theoretical:** ~10,000 (port range limit)

### Resource Planning

Per instance (idle):
- CPU: ~1-5%
- Memory: ~50MB
- Disk: ~10MB (empty DB)

Total resources needed:
```
CPU: 1 core + (instances * 0.05 cores)
Memory: 512MB + (instances * 50MB)
Disk: 10GB + (instances * 100MB average)
```

Example for 50 instances:
- CPU: 3-4 cores
- Memory: 3GB
- Disk: 15GB

### Optimization Tips

1. **Use external database** for large instances (not default SQLite)
2. **Limit concurrent requests** per instance
3. **Enable caching** in PocketBase settings
4. **Use CDN** for static assets
5. **Regular cleanup** of old data

## High Availability Setup

### Load Balancing Multiple Containers

```yaml
# docker-compose.ha.yml
services:
  multipb1:
    image: ghcr.io/n3-rd/multi-pb:latest
    volumes:
      - multipb-shared:/var/multipb/data:ro  # Read-only
    ports:
      - "127.0.0.1:25983:25983"
  
  multipb2:
    image: ghcr.io/n3-rd/multi-pb:latest
    volumes:
      - multipb-shared:/var/multipb/data:ro
    ports:
      - "127.0.0.1:25984:25983"
  
  haproxy:
    image: haproxy:alpine
    ports:
      - "25983:25983"
    volumes:
      - ./haproxy.cfg:/usr/local/etc/haproxy/haproxy.cfg:ro

volumes:
  multipb-shared:
```

**Note:** PocketBase uses SQLite by default which has limited multi-process write support. For HA, consider using PostgreSQL backend (requires PocketBase enterprise or custom build).

## Troubleshooting Production Issues

### High Memory Usage

```bash
# Check per-instance memory
docker exec multipb ps aux | grep pocketbase

# Restart hungry instance
docker exec multipb supervisorctl restart pb-myapp
```

### Port Exhaustion

```bash
# Check used ports
docker exec multipb jq '.instances | length' /var/multipb/data/instances.json

# Maximum: ~10,000 (port range 30000-39999)
```

### Instance Won't Start

```bash
# Check logs
docker exec multipb tail -100 /var/log/supervisor/pb-myapp.err.log

# Check data directory
docker exec multipb ls -la /var/multipb/data/myapp/

# Restart supervisord
docker restart multipb
```

### Proxy Issues

```bash
# Test health endpoint
curl http://localhost:25983/_health

# Check Caddy config
docker exec multipb cat /etc/caddy/Caddyfile

# Reload proxy
docker exec multipb reload-proxy.sh
```

## Scaling Considerations

### Vertical Scaling (Single Host)

- Add more CPU/RAM to host
- Optimal: 4-8 CPU cores, 8-16GB RAM
- Can support 100-200 active instances

### Horizontal Scaling (Multiple Hosts)

- Deploy separate Multi-PB containers on different hosts
- Use external load balancer to distribute instances
- Share backups but not data volumes

### Database Scaling

- SQLite (default): Good for <100k records per instance
- PostgreSQL: Better for larger datasets
- Consider per-instance database strategy

## Disaster Recovery

### Recovery Procedures

1. **Container Failure:**
   ```bash
   docker restart multipb
   # All instances auto-restart via supervisord
   ```

2. **Data Corruption:**
   ```bash
   # Restore from backup
   docker run --rm -v multipb-data:/data -v $(pwd):/backup alpine \
     tar xzf /backup/multipb-backup.tar.gz -C /
   docker restart multipb
   ```

3. **Host Failure:**
   ```bash
   # On new host:
   # 1. Install Docker
   # 2. Restore volume data
   # 3. Run container
   docker run -d --name multipb \
     -p 25983:25983 \
     -v multipb-data:/var/multipb/data \
     ghcr.io/n3-rd/multi-pb:latest
   ```

## Support & Maintenance

### Update Checklist

- [ ] Test updates in staging environment
- [ ] Backup all data
- [ ] Pull new image
- [ ] Recreate container
- [ ] Verify all instances running
- [ ] Check health endpoints
- [ ] Monitor logs for 24h

### Maintenance Window

```bash
# Announce maintenance
# Stop accepting new requests (external proxy)

# Graceful shutdown
docker exec multipb supervisorctl stop all
docker stop multipb

# Perform maintenance (updates, backups, etc.)

# Restart
docker start multipb

# Verify all instances
docker exec multipb list-instances.sh
```

## Compliance & Auditing

### Access Logs

```bash
# Caddy access logs
docker exec multipb tail -f /var/log/supervisor/caddy.log

# Export logs for analysis
docker cp multipb:/var/log/supervisor /path/to/export/
```

### Data Location

All instance data stored in: `/var/multipb/data/{instance}/`

Each instance has:
- `data.db` - SQLite database
- `pb_migrations/` - Schema migrations
- `pb_hooks/` - Custom hooks (if any)

### GDPR Compliance

- Each instance is isolated
- Data deletion: `remove-instance.sh <name>` (without --keep-data)
- Export: Copy `/var/multipb/data/{instance}/` directory

## License

MIT
