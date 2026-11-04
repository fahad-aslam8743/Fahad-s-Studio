import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, '..');
const distDir = path.join(desktopRoot, 'dist');
const mainFile = path.join(distDir, 'main.js');

let electronProcess = null;
let restartTimeout = null;
let isShuttingDown = false;

// 1. Wait for dev server and initial compilation
async function waitForReady(url = 'http://127.0.0.1:3001', maxAttempts = 60) {
  process.stdout.write(`[dev-watcher] Waiting for Next.js (${url}) and dist/main.js...\n`);
  for (let i = 0; i < maxAttempts; i++) {
    if (isShuttingDown) return false;
    const hasDist = fs.existsSync(mainFile);
    if (hasDist) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (res.ok || res.status === 200 || res.status === 404) {
          process.stdout.write(`[dev-watcher] Next.js and main.js ready on port 3001! Launching Electron...\n`);
          return true;
        }
      } catch {}
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  process.stdout.write(`[dev-watcher] Timeout waiting for dev server on port 3001. Launching anyway...\n`);
  return true;
}

// 2. Start or restart Electron process
function launchElectron() {
  if (isShuttingDown) return;

  if (electronProcess) {
    process.stdout.write(`[dev-watcher] Rebuilding detected: restarting Electron window...\n`);
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(electronProcess.pid), '/f', '/t']);
      } else {
        electronProcess.kill('SIGTERM');
      }
    } catch {}
    electronProcess = null;
  }

  // Resolve electron binary directly to prevent spaces-in-path issues on Windows
  let electronExe = null;
  try {
    electronExe = require('electron');
  } catch {}

  const runner = electronExe && fs.existsSync(electronExe) ? electronExe : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const args = electronExe && fs.existsSync(electronExe) ? ['.'] : ['electron', '.'];

  electronProcess = spawn(runner, args, {
    cwd: desktopRoot,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      IRFAN_DEV: '1',
      ELECTRON_ENABLE_LOGGING: '1'
    }
  });

  electronProcess.on('exit', (code) => {
    if (!isShuttingDown && code !== null && code !== 0) {
      process.stdout.write(`[dev-watcher] Electron exited with code ${code}\n`);
    }
  });
}

// 3. Watch dist directory for main/preload changes
function startWatcher() {
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  fs.watch(distDir, (eventType, filename) => {
    if (!filename || isShuttingDown) return;
    if (filename.endsWith('.js') && !filename.endsWith('.map')) {
      clearTimeout(restartTimeout);
      restartTimeout = setTimeout(() => {
        launchElectron();
      }, 350);
    }
  });
}

// 4. Clean exit handling
function cleanup() {
  isShuttingDown = true;
  clearTimeout(restartTimeout);
  if (electronProcess) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(electronProcess.pid), '/f', '/t']);
      } else {
        electronProcess.kill('SIGINT');
      }
    } catch {}
    electronProcess = null;
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

// Run
await waitForReady();
launchElectron();
startWatcher();
