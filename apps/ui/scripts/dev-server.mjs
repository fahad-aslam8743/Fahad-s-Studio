import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(here, '..');
const nextBin = path.join(uiRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

let child = null;
let shuttingDown = false;

function cleanup() {
  shuttingDown = true;
  if (child && child.pid) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t']);
      } else {
        child.kill('SIGTERM');
      }
    } catch {}
    child = null;
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

function run() {
  if (shuttingDown) return;
  process.stdout.write('[ui-server] Starting standalone Next.js dev server on port 3001...\n');
  child = spawn(process.execPath, [nextBin, 'dev', '-p', '3001'], {
    cwd: uiRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '3001',
      NODE_ENV: 'development'
    }
  });

  child.on('exit', (code) => {
    child = null;
    if (shuttingDown) return;
    if (code === 0) {
      process.exit(0);
    } else {
      process.stdout.write(`[ui-server] Next.js exited with code ${code}. Press Ctrl+C to stop, or restarting in 2s...\n`);
      setTimeout(run, 2000);
    }
  });
}

run();
