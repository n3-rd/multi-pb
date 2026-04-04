#!/usr/bin/env bun

const http = require("http");
const crypto = require("crypto");
const { exec, spawn } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const PORT = 3001;
const MANIFEST_FILE = "/var/multipb/data/instances.json";
const DATA_DIR = "/var/multipb/data";
const LOG_DIR = "/var/log/multipb";
const BACKUP_DIR = "/var/multipb/backups";
const CONFIG_FILE = "/var/multipb/data/config.json";
const HISTORY_FILE = "/var/multipb/data/health_history.json";
const VERSIONS_DIR = "/var/multipb/data/versions";

let config = {};
let healthHistory = {};
let lastHealthStatus = {}; // store last status to detect changes
let lastOverQuota = {}; // store last over-quota state for notifications
let adminToken = null; // Admin token for API authorization

async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf8");
    config = JSON.parse(data);
  } catch (e) {
    // use defaults if no config
    config = {
      notifications: { webhookUrl: "" },
      monitoring: { intervalSeconds: 60, historyRetentionCount: 100 },
      dns: { domain: "" },
    };
  }
  if (!config.dns) config.dns = { domain: "" };

  // Load admin token from config (priority) or environment
  // Empty strings are falsy and will result in null (authorization disabled)
  const envToken = process.env.MULTIPB_ADMIN_TOKEN;
  const configToken = config.adminToken;

  // New logic: Config token overrides ENV token if present and not empty
  // This allows changing the token via CLI/API even if ENV was set at launch
  if (configToken && typeof configToken === 'string' && configToken.length > 0) {
    adminToken = configToken;
  } else {
    adminToken = envToken || null;
  }

  if (adminToken) {
    console.log("Admin token configured - API authorization enabled");
    const source = (configToken && configToken.length > 0) ? "config.json" : "MULTIPB_ADMIN_TOKEN env var";
    console.log(`  Source: ${source}`);
  } else {
    console.log("Admin token not configured - API is open (no authorization required)");
  }
}

// Watch for config changes
let fsWatcher = null;
function startConfigWatcher() {
  try {
    if (fsWatcher) fsWatcher.close();

    let debounceTimer = null;
    // Watch the data directory instead of the specific file to catch creation/deletion
    // config.json might be recreated atomically (rename) which some file watchers miss on the file itself
    fsWatcher = fsSync.watch(DATA_DIR, (eventType, filename) => {
      if (filename === 'config.json' && (eventType === 'rename' || eventType === 'change')) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          console.log(`Config file changed (${eventType}), reloading...`);
          loadConfig();
        }, 100);
      }
    });
    console.log(`Watching ${DATA_DIR} for config.json changes...`);
  } catch (e) {
    console.log(`Config file watcher failed: ${e.message}`);
  }
}

async function getRestoreStatus() {
  const statusFile = "/var/multipb/restore.status";
  try {
    const data = await fs.readFile(statusFile, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return { restoring: false, current: "", completed: 0, total: 0, error: e.code };
  }
}

async function loadHistory() {
  try {
    const data = await fs.readFile(HISTORY_FILE, "utf8");
    healthHistory = JSON.parse(data);
  } catch (e) {
    healthHistory = {};
  }
}

async function saveHistory() {
  try {
    await fs.writeFile(HISTORY_FILE, JSON.stringify(healthHistory, null, 2));
  } catch (e) {
    console.error("Failed to save history:", e.message);
  }
}

async function sendNotification(message, type) {
  if (!config.notifications?.webhookUrl) return;

  try {
    // Simple discord/slack compatible payload
    const payload = {
      content: `[Multi-PB] ${type}: ${message}`,
      username: "Multi-PB Monitor",
    };

    // For Discord params
    const url = new URL(config.notifications.webhookUrl);

    const req = (url.protocol === "https:" ? require("https") : http).request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
    );

    req.on("error", (e) => console.error("Notification failed:", e.message));
    req.write(JSON.stringify(payload));
    req.end();
  } catch (e) {
    console.error("Notification error:", e.message);
  }
}

async function monitorLoop() {
  // Initial load
  await loadConfig();
  await loadHistory();
  startConfigWatcher(); // Start watching file

  const interval = (config.monitoring?.intervalSeconds || 60) * 1000;

  console.log(`Starting health monitor (interval: ${interval}ms)`);

  setInterval(async () => {
    // Reload config periodically (backup for watcher)
    await loadConfig();

    const manifest = await readManifest();
    const timestamp = new Date().toISOString();

    for (const [name, data] of Object.entries(manifest)) {
      const health = await getInstanceHealth(data.port);
      const isHealthy =
        health !== null && (health.code === 200 || health.code === undefined); // _health returns 200/json

      // 1. History
      if (!healthHistory[name]) healthHistory[name] = [];
      healthHistory[name].push({ t: timestamp, h: isHealthy ? 1 : 0 });

      // Prune history
      const limit = config.monitoring?.historyRetentionCount || 100;
      if (healthHistory[name].length > limit) {
        healthHistory[name] = healthHistory[name].slice(-limit);
      }

      // 2. Notifications
      if (lastHealthStatus[name] !== undefined) {
        if (lastHealthStatus[name] && !isHealthy) {
          // Went DOWN
          console.log(`[Monitor] ${name} went DOWN`);
          sendNotification(`Instance **${name}** is DOWN!`, "ALERT");
        } else if (!lastHealthStatus[name] && isHealthy) {
          // Recovered
          console.log(`[Monitor] ${name} RECOVERED`);
          sendNotification(`Instance **${name}** has recovered.`, "INFO");
        }
      }
      lastHealthStatus[name] = isHealthy;

      // 3. Size limit check (when sizeLimit is set)
      const sizeLimit = data.sizeLimit;
      if (sizeLimit) {
        const instanceDir = path.join(DATA_DIR, name);
        const sizeBytes = await getDirSizeBytes(instanceDir);
        const limitBytes = parseSizeToBytes(sizeLimit);
        const overQuota = limitBytes != null && limitBytes > 0 && sizeBytes > limitBytes;
        if (overQuota && !lastOverQuota[name]) {
          console.log(`[Monitor] ${name} exceeded size limit (${sizeLimit})`);
          sendNotification(
            `Instance **${name}** exceeded size limit (${sizeLimit}). Current: ${formatBytes(sizeBytes)}.`,
            "ALERT",
          );
        }
        lastOverQuota[name] = overQuota;
      }
    }

    await saveHistory();
  }, interval);
}

// Start monitor
// Health monitor start moved to entry point guard at the end of the file.

async function execScript(script, args = []) {
  const cmd = `/usr/local/bin/${script} ${args.join(" ")}`;
  console.log(`Executing: ${cmd}`);
  try {
    const { stdout, stderr } = await execAsync(cmd);
    if (stdout) console.log(`stdout: ${stdout.trim()}`);
    if (stderr) console.error(`stderr: ${stderr.trim()}`);
    return { success: true, stdout, stderr };
  } catch (error) {
    console.error(`Error executing ${script}: ${error.message}`);
    if (error.stdout) console.log(`stdout: ${error.stdout.trim()}`);
    if (error.stderr) console.error(`stderr: ${error.stderr.trim()}`);
    return {
      success: false,
      error: error.message,
      stdout: error.stdout,
      stderr: error.stderr,
    };
  }
}

async function getDirSize(directory) {
  try {
    const { stdout } = await execAsync(
      `du -sh "${directory}" 2>/dev/null | cut -f1`,
    );
    return stdout.trim() || "0B";
  } catch (e) {
    return "0B";
  }
}

async function getDirSizeBytes(directory) {
  try {
    const { stdout } = await execAsync(
      `du -sb "${directory}" 2>/dev/null | cut -f1`,
    );
    return parseInt(stdout.trim(), 10) || 0;
  } catch (e) {
    return 0;
  }
}

// Parse human size like "512MB", "1GB", "1GiB" to bytes
function parseSizeToBytes(str) {
  if (!str || typeof str !== "string") return null;
  const m = str.trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTP]?)(i?)[B]?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || "B").toUpperCase();
  const binary = (m[3] || "").toLowerCase() === "i";
  const k = binary ? 1024 : 1000;
  const units = { B: 0, K: 1, M: 2, G: 3, T: 4, P: 5 };
  const exp = units[unit] ?? 0;
  return Math.floor(n * Math.pow(k, exp));
}

async function getSystemStats() {
  try {
    const { stdout: loadAvg } = await execAsync(
      'cat /proc/loadavg 2>/dev/null || uptime | grep -oE "load average[s]?: [0-9.]+" | grep -oE "[0-9.]+"',
    );
    const load = parseFloat(loadAvg.split(" ")[0]) || 0;

    let memoryPercent = 0;
    try {
      const { stdout: memInfo } = await execAsync(
        "free -m 2>/dev/null | awk 'NR==2{printf \"%.1f\", $3*100/$2}'",
      );
      memoryPercent = parseFloat(memInfo) || 0;
    } catch (e) { }

    let diskUsage = "0B";
    try {
      const { stdout: du } = await execAsync(
        `du -sh "${DATA_DIR}" 2>/dev/null | cut -f1`,
      );
      diskUsage = du.trim() || "0B";
    } catch (e) { }

    return { load: load.toFixed(2), memoryPercent, diskUsage };
  } catch (e) {
    return { load: null, memoryPercent: null, diskUsage: "0B" };
  }
}

async function readManifest() {
  try {
    const data = await fs.readFile(MANIFEST_FILE, "utf8");
    return JSON.parse(data);
  } catch (error) {
    return {};
  }
}

async function writeManifest(manifest) {
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

async function getLogs(instanceName, lineCount = 200) {
  try {
    const logFile = path.join(LOG_DIR, `${instanceName}.log`);
    const errFile = path.join(LOG_DIR, `${instanceName}.err.log`);

    let logs = "";
    try {
      const { stdout } = await execAsync(
        `tail -n ${lineCount} "${logFile}" 2>/dev/null`,
      );
      logs = stdout;
    } catch (e) {
      logs = "(No logs found)";
    }

    let errLogs = "";
    try {
      const { stdout } = await execAsync(`tail -n 50 "${errFile}" 2>/dev/null`);
      errLogs = stdout;
    } catch (e) { }

    return { logs, errLogs };
  } catch (error) {
    return { logs: "", errLogs: `Error: ${error.message}` };
  }
}

async function getInstanceHealth(port) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: port,
        path: "/api/health",
        method: "GET",
        timeout: 2000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// Proxy request to PocketBase instance
function proxyToPocketBase(port, method, pbPath, body, authToken) {
  return new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (authToken) headers["Authorization"] = authToken;
    if (body) headers["Content-Length"] = Buffer.byteLength(body);

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: port,
        path: pbPath,
        method: method,
        headers,
        timeout: 30000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, data, headers: res.headers });
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });
    if (body) req.write(body);
    req.end();
  });
}

// Get collections info from PocketBase
async function getCollections(port, authToken) {
  try {
    const result = await proxyToPocketBase(
      port,
      "GET",
      "/api/collections",
      null,
      authToken,
    );
    if (result.status === 200) {
      return JSON.parse(result.data);
    }
    return null;
  } catch (e) {
    return null;
  }
}

// List backups for an instance
async function listBackups(instanceName) {
  try {
    const instanceBackupDir = path.join(BACKUP_DIR, instanceName);
    try {
      await fs.access(instanceBackupDir);
    } catch {
      return [];
    }

    const files = await fs.readdir(instanceBackupDir);
    const backups = await Promise.all(
      files
        .filter((f) => f.endsWith(".zip"))
        .map(async (f) => {
          const filePath = path.join(instanceBackupDir, f);
          const stat = await fs.stat(filePath);
          return {
            name: f,
            size: formatBytes(stat.size),
            created: stat.mtime.toISOString(),
          };
        }),
    );
    return backups.sort((a, b) => new Date(b.created) - new Date(a.created));
  } catch (e) {
    return [];
  }
}

// Create backup
async function createBackup(instanceName) {
  const instanceDir = path.join(DATA_DIR, instanceName);
  const instanceBackupDir = path.join(BACKUP_DIR, instanceName);

  // Ensure backup directory exists
  await fs.mkdir(instanceBackupDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupName = `backup-${timestamp}.zip`;
  const backupPath = path.join(instanceBackupDir, backupName);

  try {
    // PocketBase with --dir puts files directly in instance dir (data.db, pb_migrations, etc.)
    await execAsync(`cd "${instanceDir}" && zip -r "${backupPath}" .`);
    const stat = await fs.stat(backupPath);
    return {
      success: true,
      backup: {
        name: backupName,
        size: formatBytes(stat.size),
        created: stat.mtime.toISOString(),
      },
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Delete backup
async function deleteBackup(instanceName, backupName) {
  const backupPath = path.join(BACKUP_DIR, instanceName, backupName);
  try {
    await fs.unlink(backupPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// Restore backup
async function restoreBackup(instanceName, backupName) {
  const instanceDir = path.join(DATA_DIR, instanceName);
  const backupPath = path.join(BACKUP_DIR, instanceName, backupName);
  const tempBackupDir = path.join(
    DATA_DIR,
    `${instanceName}_restore_backup_${Date.now()}`,
  );

  try {
    // Stop instance first
    await execScript("stop-instance.sh", [instanceName]);

    // Backup current data by renaming entire instance dir
    try {
      await fs.rename(instanceDir, tempBackupDir);
      await fs.mkdir(instanceDir, { recursive: true });
    } catch (e) { }

    // Extract backup directly to instance dir
    await execAsync(`cd "${instanceDir}" && unzip -o "${backupPath}"`);

    // Start instance
    await execScript("start-instance.sh", [instanceName]);

    // Clean up old data after successful restore
    try {
      await fs.rm(tempBackupDir, { recursive: true });
    } catch (e) { }

    return { success: true };
  } catch (e) {
    // Try to restore old data
    try {
      await fs.rm(instanceDir, { recursive: true });
      await fs.rename(tempBackupDir, instanceDir);
    } catch (e2) { }

    await execScript("start-instance.sh", [instanceName]);
    return { success: false, error: e.message };
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return "0B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + sizes[i];
}

// Get instance details including collections count
async function getInstanceDetails(name, instanceData) {
  const port = typeof instanceData === "object" ? instanceData.port : instanceData;
  const sizeLimit = typeof instanceData === "object" ? instanceData.sizeLimit : null;

  const instanceDir = path.join(DATA_DIR, name);
  const size = await getDirSize(instanceDir);
  const sizeBytes = await getDirSizeBytes(instanceDir);
  const health = await getInstanceHealth(port);

  const limitBytes = sizeLimit ? parseSizeToBytes(sizeLimit) : null;
  const overQuota = limitBytes != null && limitBytes > 0 && sizeBytes > limitBytes;

  // Count files in pb_data
  let recordsEstimate = 0;
  try {
    const dbPath = path.join(instanceDir, "pb_data", "data.db");
    const stat = await fs.stat(dbPath);
    recordsEstimate = Math.floor(stat.size / 1024); // rough estimate
  } catch (e) { }

  const result = {
    size,
    sizeBytes,
    healthy: health !== null,
    healthData: health,
  };
  if (sizeLimit) result.sizeLimit = sizeLimit;
  if (overQuota) result.overQuota = true;
  return result;
}

// Parse request body
async function parseBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

// Check authorization (constant-time compare when token is set)
function checkAuthorization(authHeader) {
  if (!adminToken) return true;
  if (!authHeader || typeof authHeader !== "string") return false;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (token.length !== adminToken.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(adminToken, "utf8"));
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS",
  );
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const authToken = req.headers.authorization;

  const sendJson = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // When admin token is set, require it for all requests (read and write)
  if (adminToken && !checkAuthorization(authToken)) {
    return sendJson(401, { error: "Unauthorized", code: "admin_token_required" });
  }

  try {
    // GET /api/auth/status - Check if auth is enabled (no auth required for this endpoint)
    if (pathname === "/api/auth/status" && req.method === "GET") {
      return sendJson(200, {
        authRequired: !!adminToken,
        configured: adminToken !== null,
      });
    }

    // GET /api/stats
    if (pathname === "/api/stats" && req.method === "GET") {
      const stats = await getSystemStats();
      return sendJson(200, stats);
    }

    // GET /api/system/status
    if (pathname === "/api/system/status" && req.method === "GET") {
      const status = await getRestoreStatus();
      return sendJson(200, status);
    }

    // GET /api/notifications/config
    if (pathname === "/api/notifications/config" && req.method === "GET") {
      return sendJson(200, {
        webhookUrl: config.notifications?.webhookUrl || "",
      });
    }

    // GET /api/dns/config
    if (pathname === "/api/dns/config" && req.method === "GET") {
      // Config wins over env (so dashboard edits are always reflected)
      const domain =
        config.dns?.domain ||
        process.env.MULTIPB_DOMAIN ||
        "";
      return sendJson(200, { domain });
    }

    // PATCH /api/dns/config
    if (pathname === "/api/dns/config" && req.method === "PATCH") {
      const body = await parseBody(req);
      const domain =
        typeof body.domain === "string" ? body.domain.trim() : "";

      // Validate domain if non-empty
      if (domain) {
        if (domain.includes("://")) {
          return sendJson(400, { error: "Enter a domain name, not a URL (no http:// or https://)" });
        }
        if (/\s/.test(domain)) {
          return sendJson(400, { error: "Domain must not contain spaces" });
        }
        if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(domain)) {
          return sendJson(400, { error: "Invalid domain format" });
        }
      }

      config.dns = config.dns || {};
      config.dns.domain = domain;
      await fs.writeFile(
        CONFIG_FILE,
        JSON.stringify(config, null, 2),
        "utf8",
      );

      // Reload proxy — surface errors to the caller
      let reloadError = null;
      try {
        await execAsync("/usr/local/bin/reload-proxy.sh");
      } catch (e) {
        console.error("reload-proxy after DNS update:", e.message);
        reloadError = e.stderr || e.message;
      }

      if (reloadError) {
        return sendJson(207, {
          domain,
          warning: "Domain saved but Caddy reload failed",
          reloadError,
        });
      }
      return sendJson(200, { domain });
    }

    // GET /api/instances
    if (pathname === "/api/instances" && req.method === "GET") {
      const manifest = await readManifest();
      const instances = await Promise.all(
        Object.entries(manifest).map(async ([name, data]) => {
          const details = await getInstanceDetails(name, data);
          return {
            name,
            port: data.port,
            status: data.status || "unknown",
            created: data.created || null,
            version: data.version || null,
            ...details,
          };
        }),
      );
      return sendJson(200, { instances });
    }

    // GET /api/ports/check/:port - Check if port is available
    const portCheckMatch = pathname.match(/^\/api\/ports\/check\/(\d+)$/);
    if (portCheckMatch && req.method === "GET") {
      const port = parseInt(portCheckMatch[1], 10);
      const manifest = await readManifest();
      const usedPorts = Object.values(manifest).map((i) => i.port);
      const available = !usedPorts.includes(port);
      const inRange = port >= 30000 && port <= 39999;
      return sendJson(200, {
        port,
        available: available && inRange,
        inRange,
        inUse: usedPorts.includes(port),
      });
    }

    // GET /api/ports/used - List all used ports
    if (pathname === "/api/ports/used" && req.method === "GET") {
      const manifest = await readManifest();
      const usedPorts = Object.entries(manifest).map(([name, data]) => ({
        port: data.port,
        instance: name,
      }));
      return sendJson(200, {
        ports: usedPorts,
        range: { min: 30000, max: 39999 },
      });
    }

    // POST /api/instances
    if (pathname === "/api/instances" && req.method === "POST") {
      const { name, email, password, port, memory, version, sizeLimit } = await parseBody(req);
      if (!name) return sendJson(400, { error: "Instance name required" });

      // Validate port if provided
      if (port !== undefined && port !== null && port !== "") {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum)) {
          return sendJson(400, { error: "Port must be a number" });
        }
        if (portNum < 30000 || portNum > 39999) {
          return sendJson(400, {
            error: "Port must be between 30000 and 39999",
          });
        }
        const manifest = await readManifest();
        const usedPorts = Object.values(manifest).map((i) => i.port);
        if (usedPorts.includes(portNum)) {
          return sendJson(400, { error: `Port ${portNum} is already in use` });
        }
      }

      const args = [name];
      if (email) args.push("--email", email);
      if (password) args.push("--password", password);
      if (port) args.push("--port", port.toString());
      if (memory) args.push("--memory", memory);
      if (version) args.push("--version", version);
      if (sizeLimit) args.push("--size-limit", sizeLimit);

      const result = await execScript("add-instance.sh", args);
      if (result.success) {
        return sendJson(200, {
          success: true,
          credentials: {
            email: email || `admin@${name}.local`,
            password: password || "changeme123",
          },
        });
      }
      // Include both stderr and stdout in error message for better debugging
      const errorMsg = result.stderr || result.stdout || result.error || "Unknown error";
      return sendJson(500, { error: errorMsg });
    }

    // POST /api/import?name=xxx
    if (pathname === "/api/import" && req.method === "POST") {
      const name = url.searchParams.get("name");
      if (!name) return sendJson(400, { error: "Name parameter required" });

      const tempFile = path.join(BACKUP_DIR, `import-${Date.now()}.zip`);

      try {
        await fs.mkdir(BACKUP_DIR, { recursive: true });
        const fileStream = fsSync.createWriteStream(tempFile);

        await new Promise((resolve, reject) => {
          req.pipe(fileStream);
          req.on("end", resolve);
          req.on("error", reject);
        });

        // Run import script
        const result = await execScript("import-instance.sh", [tempFile, name]);

        // Cleanup
        await fs.unlink(tempFile).catch(() => { });

        if (result.success) {
          return sendJson(200, { success: true, name });
        } else {
          return sendJson(500, { error: result.stderr || result.stdout });
        }
      } catch (e) {
        return sendJson(500, { error: e.message });
      }
    }

    // GET /api/instances/:name
    const instanceMatch = pathname.match(/^\/api\/instances\/([^\/]+)$/);
    if (instanceMatch && req.method === "GET") {
      const name = instanceMatch[1];
      const manifest = await readManifest();
      if (!manifest[name])
        return sendJson(404, { error: "Instance not found" });

      const data = manifest[name];
      const details = await getInstanceDetails(name, data);
      const backups = await listBackups(name);
      const history = healthHistory[name] || [];

      return sendJson(200, {
        name,
        port: data.port,
        status: data.status,
        created: data.created,
        version: data.version || null,
        memory: data.memory || null,
        ...details,
        backups,
        history,
      });
    }

    // PATCH /api/instances/:name/settings
    const settingsMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/settings$/,
    );
    if (settingsMatch && req.method === "PATCH") {
      const name = settingsMatch[1];
      const body = await parseBody(req);
      const manifest = await readManifest();
      if (!manifest[name])
        return sendJson(404, { error: "Instance not found" });

      let updated = false;
      if (body.sizeLimit !== undefined) {
        if (body.sizeLimit === "" || body.sizeLimit == null) {
          delete manifest[name].sizeLimit;
        } else {
          manifest[name].sizeLimit = String(body.sizeLimit);
        }
        updated = true;
      }
      if (body.memory !== undefined) {
        if (body.memory === "" || body.memory == null) {
          delete manifest[name].memory;
        } else {
          manifest[name].memory = String(body.memory);
        }
        updated = true;
      }
      if (!updated) return sendJson(400, { error: "No valid settings to update" });

      await writeManifest(manifest);

      // If memory changed, regenerate supervisord config and restart
      if (body.memory !== undefined) {
        try {
          const instanceDir = path.join(DATA_DIR, name);
          const instanceData = manifest[name];
          const { stdout: binaryPath } = await execAsync(
            `/usr/local/bin/manage-versions.sh path ${instanceData.version || "latest"}`,
          );
          const pbBinary = binaryPath.trim();
          const SUPERVISOR_CONF = `/etc/supervisor/conf.d/${name}.conf`;
          await fs.writeFile(
            SUPERVISOR_CONF,
            `[program:pb-${name}]
command=${pbBinary} serve --dir=${instanceDir} --http=127.0.0.1:${instanceData.port}
directory=${instanceDir}
autostart=true
autorestart=true
startretries=3
stderr_logfile=/var/log/multipb/${name}.err.log
stdout_logfile=/var/log/multipb/${name}.log
stderr_logfile_maxbytes=10MB
stdout_logfile_maxbytes=10MB
stderr_logfile_backups=3
stdout_logfile_backups=3
user=root
environment=HOME="/root"${instanceData.memory ? `,GOMEMLIMIT="${instanceData.memory}"` : ""}
`,
          );
          await execAsync(
            "supervisorctl -c /etc/supervisor/supervisord.conf -s unix:///var/run/supervisor.sock reread",
          );
          await execAsync(
            "supervisorctl -c /etc/supervisor/supervisord.conf -s unix:///var/run/supervisor.sock update",
          );
        } catch (e) {
          console.error("Failed to update supervisord:", e.message);
        }
      }
      const details = await getInstanceDetails(name, manifest[name]);
      return sendJson(200, { success: true, ...manifest[name], ...details });
    }

    // GET /api/instances/:name/history
    const historyMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/history$/,
    );
    if (historyMatch && req.method === "GET") {
      const name = historyMatch[1];
      const history = healthHistory[name] || [];
      return sendJson(200, { history });
    }

    // DELETE /api/instances/:name
    if (instanceMatch && req.method === "DELETE") {
      const name = instanceMatch[1];
      const result = await execScript("remove-instance.sh", [
        name,
        "--delete-data",
      ]);
      if (result.success) return sendJson(200, { success: true });
      return sendJson(500, { error: result.error || result.stderr });
    }

    // POST /api/instances/:name/start
    const startMatch = pathname.match(/^\/api\/instances\/([^\/]+)\/start$/);
    if (startMatch && req.method === "POST") {
      const name = startMatch[1];
      const result = await execScript("start-instance.sh", [name]);
      if (result.success) return sendJson(200, { success: true });
      return sendJson(500, { error: result.error || result.stderr });
    }

    // POST /api/instances/:name/stop
    const stopMatch = pathname.match(/^\/api\/instances\/([^\/]+)\/stop$/);
    if (stopMatch && req.method === "POST") {
      const name = stopMatch[1];
      const result = await execScript("stop-instance.sh", [name]);
      if (result.success) return sendJson(200, { success: true });
      return sendJson(500, { error: result.error || result.stderr });
    }

    // POST /api/instances/:name/restart
    const restartMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/restart$/,
    );
    if (restartMatch && req.method === "POST") {
      const name = restartMatch[1];
      await execScript("stop-instance.sh", [name]);
      const result = await execScript("start-instance.sh", [name]);
      if (result.success) return sendJson(200, { success: true });
      return sendJson(500, { error: result.error || result.stderr });
    }

    // GET /api/instances/:name/logs
    const logsMatch = pathname.match(/^\/api\/instances\/([^\/]+)\/logs$/);
    if (logsMatch && req.method === "GET") {
      const name = logsMatch[1];
      const { logs, errLogs } = await getLogs(name, 200);
      return sendJson(200, { logs, errLogs });
    }

    // === BACKUPS ===

    // GET /api/instances/:name/backups
    const backupsMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/backups$/,
    );
    if (backupsMatch && req.method === "GET") {
      const name = backupsMatch[1];
      const backups = await listBackups(name);
      return sendJson(200, { backups });
    }

    // POST /api/instances/:name/backups
    if (backupsMatch && req.method === "POST") {
      const name = backupsMatch[1];
      const result = await createBackup(name);
      if (result.success) return sendJson(200, result);
      return sendJson(500, result);
    }

    // DELETE /api/instances/:name/backups/:backupName
    const backupDeleteMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/backups\/([^\/]+)$/,
    );
    if (backupDeleteMatch && req.method === "DELETE") {
      const [, name, backupName] = backupDeleteMatch;
      const result = await deleteBackup(name, backupName);
      if (result.success) return sendJson(200, result);
      return sendJson(500, result);
    }

    // POST /api/instances/:name/backups/:backupName/restore
    const backupRestoreMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/backups\/([^\/]+)\/restore$/,
    );
    if (backupRestoreMatch && req.method === "POST") {
      const [, name, backupName] = backupRestoreMatch;
      const result = await restoreBackup(name, backupName);
      if (result.success) return sendJson(200, result);
      return sendJson(500, result);
    }

    // GET /api/instances/:name/backups/:backupName/download
    const backupDownloadMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/backups\/([^\/]+)\/download$/,
    );
    if (backupDownloadMatch && req.method === "GET") {
      const [, name, backupName] = backupDownloadMatch;
      const backupPath = path.join(BACKUP_DIR, name, backupName);

      try {
        const stat = await fs.stat(backupPath);
        res.writeHead(200, {
          "Content-Type": "application/zip",
          "Content-Length": stat.size,
          "Content-Disposition": `attachment; filename="${backupName}"`,
        });
        fsSync.createReadStream(backupPath).pipe(res);
        return;
      } catch (e) {
        return sendJson(404, { error: "Backup not found" });
      }
    }

    // === VERSION MANAGEMENT ===

    // GET /api/versions/latest
    if (pathname === "/api/versions/latest" && req.method === "GET") {
      try {
        const { stdout } = await execAsync(
          "/usr/local/bin/manage-versions.sh latest",
        );
        const version = stdout.trim();
        return sendJson(200, { version });
      } catch (e) {
        return sendJson(500, { error: e.message });
      }
    }

    // GET /api/versions/available
    if (pathname === "/api/versions/available" && req.method === "GET") {
      try {
        const { stdout } = await execAsync(
          "/usr/local/bin/manage-versions.sh available",
        );
        const versions = stdout
          .trim()
          .split("\n")
          .filter((v) => v);
        return sendJson(200, { versions });
      } catch (e) {
        return sendJson(500, { error: e.message });
      }
    }

    // GET /api/versions/installed
    if (pathname === "/api/versions/installed" && req.method === "GET") {
      try {
        const { stdout } = await execAsync(
          "/usr/local/bin/manage-versions.sh installed",
        );
        const versions = stdout
          .trim()
          .split("\n")
          .filter((v) => v);
        return sendJson(200, { versions });
      } catch (e) {
        return sendJson(200, { versions: [] });
      }
    }

    // POST /api/versions/download
    if (pathname === "/api/versions/download" && req.method === "POST") {
      const { version } = await parseBody(req);
      if (!version) return sendJson(400, { error: "Version required" });

      try {
        const result = await execScript("manage-versions.sh", [
          "download",
          version,
        ]);
        if (result.success) {
          return sendJson(200, { success: true, version });
        }
        return sendJson(500, { error: result.error || result.stderr });
      } catch (e) {
        return sendJson(500, { error: e.message });
      }
    }

    // DELETE /api/versions/:version
    const versionDeleteMatch = pathname.match(/^\/api\/versions\/([^\/]+)$/);
    if (versionDeleteMatch && req.method === "DELETE") {
      const version = versionDeleteMatch[1];
      try {
        const result = await execScript("manage-versions.sh", [
          "delete",
          version,
        ]);
        if (result.success) {
          return sendJson(200, { success: true });
        }
        return sendJson(500, { error: result.error || result.stderr });
      } catch (e) {
        return sendJson(500, { error: e.message });
      }
    }

    // POST /api/instances/:name/upgrade
    const upgradeMatch = pathname.match(/^\/api\/instances\/([^\/]+)\/upgrade$/);
    if (upgradeMatch && req.method === "POST") {
      const name = upgradeMatch[1];
      const { version } = await parseBody(req);
      if (!version) return sendJson(400, { error: "Version required" });

      try {
        // Stop instance
        await execScript("stop-instance.sh", [name]);

        // Download version if not installed
        await execScript("manage-versions.sh", ["download", version]);

        // Update manifest
        const manifest = await readManifest();
        if (!manifest[name]) {
          return sendJson(404, { error: "Instance not found" });
        }
        manifest[name].version = version;
        await writeManifest(manifest);

        // Update supervisord config with new binary path
        const { stdout: binaryPath } = await execAsync(
          `/usr/local/bin/manage-versions.sh path ${version}`,
        );
        const pbBinary = binaryPath.trim();

        const SUPERVISOR_CONF = `/etc/supervisor/conf.d/${name}.conf`;
        const instanceDir = path.join(DATA_DIR, name);
        const instanceData = manifest[name];

        await fs.writeFile(
          SUPERVISOR_CONF,
          `[program:pb-${name}]
command=${pbBinary} serve --dir=${instanceDir} --http=127.0.0.1:${instanceData.port}
directory=${instanceDir}
autostart=true
autorestart=true
startretries=3
stderr_logfile=/var/log/multipb/${name}.err.log
stdout_logfile=/var/log/multipb/${name}.log
stderr_logfile_maxbytes=10MB
stdout_logfile_maxbytes=10MB
stderr_logfile_backups=3
stdout_logfile_backups=3
user=root
environment=HOME="/root"${instanceData.memory ? `,GOMEMLIMIT="${instanceData.memory}"` : ""}
`,
        );

        // Reload supervisord
        await execAsync(
          "supervisorctl -c /etc/supervisor/supervisord.conf -s unix:///var/run/supervisor.sock reread",
        );
        await execAsync(
          "supervisorctl -c /etc/supervisor/supervisord.conf -s unix:///var/run/supervisor.sock update",
        );

        // Start instance
        await execScript("start-instance.sh", [name]);

        return sendJson(200, { success: true, version });
      } catch (e) {
        return sendJson(500, { error: e.message });
      }
    }

    // === PROXY TO POCKETBASE ===

    // GET/POST/etc /api/instances/:name/pb/*
    const pbProxyMatch = pathname.match(
      /^\/api\/instances\/([^\/]+)\/pb(\/.*)$/,
    );
    if (pbProxyMatch) {
      const [, name, pbPath] = pbProxyMatch;
      const manifest = await readManifest();
      if (!manifest[name])
        return sendJson(404, { error: "Instance not found" });

      let body = null;
      if (["POST", "PUT", "PATCH"].includes(req.method)) {
        body = "";
        for await (const chunk of req) body += chunk;
      }

      try {
        const result = await proxyToPocketBase(
          manifest[name].port,
          req.method,
          pbPath,
          body,
          authToken,
        );
        res.writeHead(result.status, {
          "Content-Type": result.headers["content-type"] || "application/json",
        });
        res.end(result.data);
      } catch (e) {
        return sendJson(502, {
          error: "Failed to connect to PocketBase: " + e.message,
        });
      }
      return;
    }

    sendJson(404, { error: "Not found" });
  } catch (error) {
    sendJson(500, { error: error.message });
  }
});

if (require.main === module) {
  monitorLoop();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`API server running on http://127.0.0.1:${PORT}`);
  });
}

module.exports = server;
