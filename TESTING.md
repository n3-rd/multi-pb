# Testing Guide

## Local Testing

### 1. Validate Scripts

```bash
./test-scripts.sh
```

This validates:
- Shell script syntax
- JSON manifest operations
- Basic functionality

### 2. Build Container

```bash
docker build -t multipb .
```

Expected output:
- PocketBase binary downloaded
- All dependencies installed
- Scripts copied and made executable
- Health check configured

### 3. Run Container

```bash
docker run -d \
  --name multipb-test \
  -p 25983:25983 \
  -v multipb-test-data:/var/multipb/data \
  multipb
```

### 4. Wait for Startup

```bash
# Wait for health check
docker ps | grep multipb-test
# Should show "healthy" after ~30 seconds

# Check logs
docker logs multipb-test
```

### 5. Test Health Endpoint

```bash
curl http://localhost:25983/_health
# Expected: OK
```

### 6. Create First Instance

```bash
docker exec multipb-test add-instance.sh app1
```

Expected output:
```
Creating instance 'app1'...
  Port: 30000
  Data directory: /var/multipb/data/app1
Regenerating configurations...
Starting instance...
Reloading reverse proxy...

✓ Instance 'app1' created successfully!

Access your instance at:
  http://localhost:25983/app1/

PocketBase admin UI:
  http://localhost:25983/app1/_/
```

### 7. Verify Instance Access

```bash
# Health check
curl http://localhost:25983/app1/api/health
# Expected: 200 OK with JSON response

# Admin UI (browser)
open http://localhost:25983/app1/_/
```

### 8. List All Instances

```bash
docker exec multipb-test list-instances.sh
```

Expected output:
```
╔══════════════════════════════════════════════════════════════╗
║                   PocketBase Instances                        ║
╚══════════════════════════════════════════════════════════════╝

NAME                 PORT       STATUS     URL
────────────────────────────────────────────────────────────────
app1                 30000      running    http://localhost:25983/app1/

Total instances: 1
```

### 9. Create Multiple Instances

```bash
docker exec multipb-test add-instance.sh app2
docker exec multipb-test add-instance.sh database
docker exec multipb-test add-instance.sh api
docker exec multipb-test list-instances.sh
```

### 10. Test Instance Operations

```bash
# Stop instance
docker exec multipb-test stop-instance.sh app2

# Start instance
docker exec multipb-test start-instance.sh app2

# Check status
docker exec multipb-test supervisorctl status pb-app2
```

### 11. Test Persistence

```bash
# Stop container
docker stop multipb-test

# Start container
docker start multipb-test

# Wait for startup
sleep 10

# Verify instances still exist
docker exec multipb-test list-instances.sh

# Verify data is intact
curl http://localhost:25983/app1/api/health
```

### 12. Test Remove Instance

```bash
# Remove without deleting data
docker exec multipb-test remove-instance.sh app2 --keep-data

# Remove with data deletion
docker exec multipb-test remove-instance.sh app3

# Verify removal
docker exec multipb-test list-instances.sh
```

### 13. Cleanup

```bash
docker stop multipb-test
docker rm multipb-test
docker volume rm multipb-test-data
```

## Integration Testing

### Test Path-Based Routing

```bash
# Create test instances
for i in {1..5}; do
    docker exec multipb-test add-instance.sh "test$i"
done

# Test each instance
for i in {1..5}; do
    echo "Testing test$i..."
    curl -f http://localhost:25983/test$i/api/health || echo "Failed!"
done
```

### Test Load

```bash
# Create many instances
for i in {1..20}; do
    docker exec multipb-test add-instance.sh "load$i"
done

# Check all running
docker exec multipb-test supervisorctl status | grep RUNNING | wc -l
# Expected: 21 (20 instances + Caddy)

# Test access
for i in {1..20}; do
    curl -s http://localhost:25983/load$i/api/health > /dev/null &
done
wait
echo "All instances responding!"
```

### Test Resource Limits

```bash
# Monitor resource usage
docker stats multipb-test --no-stream

# Create instances until limits
for i in {1..100}; do
    docker exec multipb-test add-instance.sh "scale$i" || break
    echo "Created scale$i"
    sleep 1
done
```

## Manual Testing Checklist

- [ ] Container builds successfully
- [ ] Container starts and becomes healthy
- [ ] Health endpoint returns OK
- [ ] Can create first instance
- [ ] Instance is accessible at /{instance}/
- [ ] PocketBase admin UI loads
- [ ] Can create multiple instances
- [ ] All instances get unique ports (30000+)
- [ ] List command shows all instances
- [ ] Can stop/start individual instances
- [ ] Can remove instances
- [ ] Data persists across container restarts
- [ ] Removed data is deleted (when not using --keep-data)
- [ ] Proxy routing updates automatically
- [ ] No port conflicts with many instances
- [ ] Health check fails when services are down

## Automated Testing (CI/CD)

See `.github/workflows/test.yml` for automated testing pipeline.

## Troubleshooting Tests

### Container won't start

```bash
docker logs multipb-test
# Check for:
# - Missing dependencies
# - Port conflicts
# - Permission issues
```

### Instance won't start

```bash
# Check instance logs
docker exec multipb-test cat /var/log/supervisor/pb-app1.err.log

# Check supervisor status
docker exec multipb-test supervisorctl status pb-app1

# Try manual start
docker exec multipb-test supervisorctl start pb-app1
```

### Routing not working

```bash
# Check Caddy config
docker exec multipb-test cat /etc/caddy/Caddyfile

# Check Caddy logs
docker exec multipb-test tail -f /var/log/supervisor/caddy.err.log

# Reload proxy
docker exec multipb-test reload-proxy.sh
```

### Manifest corruption

```bash
# View manifest
docker exec multipb-test cat /var/multipb/data/instances.json

# Validate JSON
docker exec multipb-test jq '.' /var/multipb/data/instances.json
```

## Performance Testing

### Benchmark Instance Creation

```bash
time for i in {1..10}; do
    docker exec multipb-test add-instance.sh "perf$i" > /dev/null
done
# Measure total time for 10 instances
```

### Benchmark Request Handling

```bash
# Install Apache Bench
apt-get install apache2-utils

# Test single instance
ab -n 1000 -c 10 http://localhost:25983/app1/api/health

# Test multiple instances concurrently
for i in {1..5}; do
    ab -n 1000 -c 10 http://localhost:25983/test$i/api/health &
done
wait
```

### Memory Profile

```bash
# Initial memory
docker stats multipb-test --no-stream | awk '{print $4}'

# Create 50 instances
for i in {1..50}; do
    docker exec multipb-test add-instance.sh "mem$i"
done

# Final memory
docker stats multipb-test --no-stream | awk '{print $4}'

# Memory per instance
# (Final - Initial) / 50
```
