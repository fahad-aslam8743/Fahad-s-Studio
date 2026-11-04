import net from 'node:net';
import { execSync, spawnSync } from 'node:child_process';

const PORTS = [3001, 8787];
const shouldClean = process.argv.includes('--clean') || process.env.CLEAN_PORTS === '1';

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

function findPidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const output = execSync(`netstat -ano`, { encoding: 'utf8' });
      for (const line of output.split('\n')) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid) && pid !== '0') {
            pids.add(Number(pid));
          }
        }
      }
    } else {
      const output = execSync(`lsof -ti :${port}`, { encoding: 'utf8' });
      for (const line of output.trim().split('\n')) {
        const pid = line.trim();
        if (pid && /^\d+$/.test(pid)) {
          pids.add(Number(pid));
        }
      }
    }
  } catch {}
  return Array.from(pids);
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch {}
}

async function waitForPortFree(port, maxWaitMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const isFree = await checkPort(port);
    if (isFree) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function main() {
  process.stdout.write(`[preflight] Checking development ports (UI: 3001, Worker: 8787)...\n`);

  for (const port of PORTS) {
    const isFree = await checkPort(port);
    if (!isFree) {
      const pids = findPidsOnPort(port);
      if (shouldClean && pids.length > 0) {
        process.stdout.write(`[preflight] Cleaning stale process on port ${port} (PID: ${pids.join(', ')})...\n`);
        for (const pid of pids) {
          killPid(pid);
        }
        const freed = await waitForPortFree(port);
        if (freed) {
          process.stdout.write(`[preflight] Port ${port} is now clear.\n`);
          continue;
        }
      }

      process.stderr.write(`\n[PREFLIGHT ERROR] Port ${port} is occupied${pids.length ? ` by PID ${pids.join(', ')}` : ''}.\n`);
      process.stderr.write(`Run "node scripts/preflight-ports.mjs --clean" to terminate stale processes before starting.\n\n`);
      process.exit(1);
    }
  }

  process.stdout.write(`[preflight] All required development ports (3001, 8787) are free.\n`);
}

main().catch((err) => {
  console.error('[preflight] Error:', err);
  process.exit(1);
});
