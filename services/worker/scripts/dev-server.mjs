import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerRoot = path.resolve(here, '..');
const wranglerBin = path.join(workerRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

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
  process.stdout.write('[worker-server] Starting standalone Cloudflare Worker dev server on port 8787...\n');
  child = spawn(process.execPath, [wranglerBin, 'dev', '--port', '8787', '--ip', '127.0.0.1'], {
    cwd: workerRoot,
    stdio: 'inherit',
    env: {
      ...process.env
    }
  });

  child.on('exit', (code) => {
    child = null;
    if (shuttingDown) return;
    if (code === 0) {
      process.exit(0);
    } else {
      process.stdout.write(`[worker-server] Worker exited with code ${code}. Press Ctrl+C to stop, or restarting in 2s...\n`);
      setTimeout(run, 2000);
    }
  });
}

run();
