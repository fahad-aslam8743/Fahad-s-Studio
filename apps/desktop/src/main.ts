import {spawnSync} from 'node:child_process';
import {autoUpdater} from 'electron-updater';
import {app,BrowserWindow,ipcMain,protocol,net,session,shell,safeStorage,globalShortcut,Tray,Menu,nativeImage,powerMonitor} from 'electron';
import {attachLocalAgent} from './local-agent';
import {attachWhatsApp} from './whatsapp';
import {getBrowserService} from './browser-service';
import {DurableOutbox, type OutboxPayload} from './scheduler-outbox';
import {getTaskRunId, getTaskAttemptId} from './scheduler-identity';
import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

// Enforce single instance across Windows to prevent duplicate microphone capture and conflicts
const isSingleInstance = app.requestSingleInstanceLock();
if (!isSingleInstance) {
  console.log('[JARVIS] Another instance is already active. Exiting.');
  app.quit();
}

let tray: Tray | null = null;
let isQuitting = false;
let backgroundMode = true;
let micEnabled = true;
let currentVoiceStatus = 'Listening';

const diagnosticLog = async (kind: string, message: string) => {
  const safe = message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').replace(/(?:key|token|secret|password)\s*[:=]\s*[^\s,]+/gi, 'credential=[REDACTED]').slice(0, 500);
  try {
    const file = path.join(app.getPath('userData'), 'desktop-errors.jsonl');
    await fs.appendFile(file, JSON.stringify({time: new Date().toISOString(), kind, message: safe}) + '\n', {mode: 0o600});
  } catch {}
};

const lifecycleFile = path.join(app.getPath('userData'), 'lifecycle-settings.json');
async function loadLifecycleSettings() {
  try {
    const raw = await fs.readFile(lifecycleFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (typeof parsed.backgroundMode === 'boolean') backgroundMode = parsed.backgroundMode;
    if (typeof parsed.micEnabled === 'boolean') micEnabled = parsed.micEnabled;
  } catch {}
}
async function saveLifecycleSettings() {
  try {
    await fs.mkdir(path.dirname(lifecycleFile), {recursive: true});
    await fs.writeFile(lifecycleFile, JSON.stringify({backgroundMode, micEnabled}), {mode: 0o600});
  } catch {}
}

function getTrayIcon() {
  const candidate = path.join(__dirname, '../assets/tray-icon.png');
  const img = nativeImage.createFromPath(candidate);
  if (!img.isEmpty()) return img;
  return nativeImage.createEmpty();
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const win = BrowserWindow.getAllWindows()[0];
  const isVisible = Boolean(win && !win.isDestroyed() && win.isVisible());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: isVisible ? 'Hide JARVIS' : 'Open JARVIS',
      click: () => {
        if (!win || win.isDestroyed()) {
          createWindow();
        } else if (win.isVisible()) {
          win.hide();
        } else {
          if (win.isMinimized()) win.restore();
          win.show();
          win.focus();
        }
        updateTrayMenu();
      }
    },
    { type: 'separator' },
    {
      label: `Status: ${micEnabled ? currentVoiceStatus : 'Microphone Muted'}`,
      enabled: false
    },
    {
      label: micEnabled ? 'Mute Microphone' : 'Enable Microphone',
      click: () => {
        micEnabled = !micEnabled;
        void saveLifecycleSettings();
        BrowserWindow.getAllWindows().forEach(w => {
          if (!w.isDestroyed()) w.webContents.send('lifecycle:mic-toggled', {enabled: micEnabled});
        });
        updateTrayMenu();
      }
    },
    {
      label: 'Run in Background (Minimize to Tray)',
      type: 'checkbox',
      checked: backgroundMode,
      click: (item) => {
        backgroundMode = item.checked;
        void saveLifecycleSettings();
      }
    },
    {
      label: 'Start with Windows',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          path: process.execPath,
          args: ['--hidden']
        });
      }
    },
    { type: 'separator' },
    {
      label: 'Quit JARVIS',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`JARVIS Assistant — ${micEnabled ? currentVoiceStatus : 'Muted'}`);
}

process.on('uncaughtException', error => {
  void diagnosticLog('uncaughtException', error.message).finally(() => app.exit(1));
});
process.on('unhandledRejection', reason => {
  void diagnosticLog('unhandledRejection', String((reason as Error)?.message || reason));
});

const dev = process.env.IRFAN_DEV === '1';
protocol.registerSchemesAsPrivileged([{scheme: 'irfan', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true}}]);

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: '#030815',
    title: "Irfan's Studio - JARVIS",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
  window.webContents.on('will-navigate', (event, url) => {
    if (!(dev ? (url.startsWith('http://localhost:3001') || url.startsWith('http://127.0.0.1:3001') || url.startsWith('http://localhost:3000')) : url.startsWith('irfan://studio/'))) {
      event.preventDefault();
    }
  });

  // Windows application lifecycle: hide to tray on close if backgroundMode enabled
  window.on('close', (event) => {
    if (!isQuitting && backgroundMode) {
      event.preventDefault();
      window.hide();
      updateTrayMenu();
      return false;
    }
  });
  window.on('show', () => updateTrayMenu());
  window.on('hide', () => updateTrayMenu());

  if (dev) void window.loadURL('http://localhost:3001');
  else void window.loadURL('irfan://studio/index.html');
}

// ── Scheduler Poller ──────────────────────────────────────────────────────────
// Polls the backend every 60 seconds for tasks that are due for execution on this PC.
// Features:
// 1. Single in-flight polling guard (isPolling) prevents overlapping poll cycles.
// 2. Stable execution IDs (taskId + scheduled run timestamp).
// 3. Atomic claiming via backend RPC with lease timeout and crash recovery.
// 4. Strict action registry: reminder, app_launch, browser_open, tool, chat.
//    Unknown action types fail safely and are NEVER marked as successful reminders.
// 5. Explicit Notification.isSupported() verification before reporting success.
// 6. Sensitive tools (delete_file, close_app) require interactive confirmation and
//    refuse silent background execution.
// 7. Full IPC chain support: sends scheduler:execute-action and correlates results.
async function startSchedulerPoller(credentialsFile: string): Promise<void> {
  const POLL_INTERVAL_MS = 60_000;
  const DEVICE_ID = 'pc';
  let isPolling = false;

  // Durable completion outbox: persists pending completion records to disk before attempting
  // network delivery, recovers on crash, and retries with exponential backoff.
  const outboxFile = path.join(app.getPath('userData'), 'scheduler-outbox.json');
  const outbox = new DurableOutbox(outboxFile);
  await outbox.load();

  async function loadCredentials(): Promise<{apiUrl: string; token: string} | null> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const bytes = await fs.readFile(credentialsFile);
      return JSON.parse(safeStorage.decryptString(bytes));
    } catch {
      return null;
    }
  }

  async function flushPendingCompletions(baseUrl: string, headers: any): Promise<void> {
    const pending = outbox.getPending();
    for (const item of pending) {
      try {
        const res = await net.fetch(baseUrl + '/tasks/' + item.taskId + '/complete', {
          method: 'POST',
          headers,
          body: JSON.stringify(item.payload)
        } as any);

        let compData: any = null;
        try {
          compData = await res.json();
        } catch {}

        if (res.ok && compData?.ok === true) {
          await outbox.remove(item.id);
          void diagnosticLog('scheduler', `Reconciled completion report for task ${item.taskId} attempt ${item.attemptId}`);
        } else if (res.status === 400 || res.status === 404 || res.status === 409) {
          // Check if server indicated a permanent final rejection
          const permanent = compData?.already_completed || ['stale_execution', 'lease_expired', 'device_mismatch', 'execution_not_found'].includes(compData?.reason);
          if (permanent) {
            await outbox.remove(item.id);
            void diagnosticLog('scheduler', `Permanent completion outcome for task ${item.taskId}: ${compData?.reason || 'already completed'}`);
          } else {
            await outbox.recordFailure(item.id, `Server rejected (${res.status}): ${compData?.reason || 'unknown'}`);
          }
        } else {
          await outbox.recordFailure(item.id, `HTTP ${res.status}: ${compData?.error || 'Server error'}`);
        }
      } catch (err: any) {
        await outbox.recordFailure(item.id, `Network error: ${err?.message || err}`);
        void diagnosticLog('scheduler', `Retry completion reporting failed for ${item.taskId}: ${err?.message}`);
      }
    }
  }

  async function pollOnce(): Promise<void> {
    if (isPolling) return; // In-flight guard: prevent concurrent polling cycles
    isPolling = true;

    try {
      const creds = await loadCredentials();
      if (!creds?.apiUrl || !creds?.token) return; // Credential setup pending

      const baseUrl = creds.apiUrl.replace(/\/$/, '');
      const headers = {'Authorization': 'Bearer ' + creds.token, 'Content-Type': 'application/json'};

      // 0. Flush any pending un-reported completions from prior network failures
      await flushPendingCompletions(baseUrl, headers);

      let dueTasks: any[];
      try {
        const res = await net.fetch(baseUrl + '/tasks/due?target=pc', {headers} as any);
        if (!res.ok) return;
        dueTasks = await res.json() as any[];
      } catch {
        return; // Worker unreachable — retry next cycle
      }

      if (!Array.isArray(dueTasks) || dueTasks.length === 0) return;

      for (const task of dueTasks) {
        if (!task?.id || typeof task.id !== 'string') continue;

        // Stable execution identifier: run identity + attempt identity
        const runId = getTaskRunId(task);
        const attemptId = getTaskAttemptId(task);

        // If execution is already locally completed and pending reconciliation, do NOT re-execute!
        if (outbox.has(attemptId)) {
          void diagnosticLog('scheduler', `Attempt ${attemptId} already completed locally; awaiting reconciliation`);
          continue;
        }

        // 1. Claim task atomically via backend RPC
        try {
          const claimRes = await net.fetch(baseUrl + '/tasks/' + task.id + '/claim', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              idempotency_key: attemptId,
              run_id: runId,
              attempt_id: attemptId,
              device_id: DEVICE_ID
            })
          } as any);

          let claimData: any = null;
          try { claimData = await claimRes.json(); } catch {}

          if (!claimRes.ok || !claimData?.claimed) {
            void diagnosticLog('scheduler', `Task ${task.id} claim rejected (${claimRes.status}): ${claimData?.reason || 'unknown'}`);
            continue;
          }
        } catch (err: any) {
          void diagnosticLog('scheduler', `Task claim network error: ${err?.message}`);
          continue;
        }

        // 2. Execute task based on strict action registry
        let success = false;
        let outcomeMsg = '';
        const actionType: string = String(task.action_type || '').toLowerCase();
        const config = task.action_config || {};
        const title: string = task.title || 'Scheduled Task';

        try {
          if (actionType === 'reminder') {
            const {Notification} = await import('electron');
            if (!Notification.isSupported()) {
              success = false;
              outcomeMsg = 'Windows desktop notifications are not supported on this host';
            } else {
              try {
                const notif = new Notification({
                  title: 'JARVIS Reminder',
                  body: config.message ? String(config.message).slice(0, 200) : title,
                  icon: path.join(__dirname, '../assets/tray-icon.png'),
                  silent: false
                });
                notif.show();
                success = true;
                outcomeMsg = 'Desktop notification shown';
              } catch (notifErr: any) {
                success = false;
                outcomeMsg = 'Notification display failed: ' + String(notifErr?.message || notifErr);
              }
            }

            // Also broadcast to any open UI window for the chat history
            BrowserWindow.getAllWindows().forEach(w => {
              if (!w.isDestroyed()) w.webContents.send('scheduler:reminder', {task});
            });

          } else if (actionType === 'app_launch') {
            const appName = String(config.name || config.app || 'calc');
            const {runNative} = await import('./local-tools');
            try {
              await runNative('open_app', {name: appName});
              success = true;
              outcomeMsg = `Launched application: ${appName}`;
            } catch (err: any) {
              success = false;
              outcomeMsg = `Application launch failed: ${String(err?.message || err)}`;
            }

          } else if (actionType === 'browser_open') {
            const url = String(config.url || '');
            if (/^https?:\/\//i.test(url)) {
              const {runNative} = await import('./local-tools');
              try {
                await runNative('browser_open', {url});
                success = true;
                outcomeMsg = `Opened URL in Chrome: ${url}`;
              } catch (err: any) {
                success = false;
                outcomeMsg = `Browser open failed: ${String(err?.message || err)}`;
              }
            } else {
              success = false;
              outcomeMsg = 'Invalid or non-HTTPS URL specified in task config';
            }

          } else if (actionType === 'tool') {
            const toolName = String(config.tool || config.name || '') as any;
            const {runNative, specs} = await import('./local-tools');

            if (!specs[toolName]) {
              success = false;
              outcomeMsg = `Unknown or unsupported desktop tool: '${toolName}'`;
            } else {
              // Safety policy: sensitive tools cannot run silently in background without interactive user approval
              const isSensitive = ['delete_file', 'move_file', 'ui_automation', 'close_app'].includes(toolName);
              if (isSensitive) {
                success = false;
                outcomeMsg = `Tool '${toolName}' requires interactive confirmation and cannot run silently in background`;
              } else {
                try {
                  await runNative(toolName, config.args || {});
                  success = true;
                  outcomeMsg = `Tool '${toolName}' executed successfully`;
                } catch (err: any) {
                  success = false;
                  outcomeMsg = `Tool execution failed: ${String(err?.message || err)}`;
                }
              }
            }

          } else if (actionType === 'chat') {
            // Forward to renderer window
            const activeWindows = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed());
            if (activeWindows.length === 0) {
              success = false;
              outcomeMsg = 'Renderer window not available to receive scheduled chat directive';
            } else {
              const executed = await new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 12_000);
                ipcMain.once('scheduler:execute-result:' + task.id, (_e, result) => {
                  clearTimeout(timeout);
                  resolve(Boolean(result?.success));
                });
                activeWindows.forEach(w => {
                  w.webContents.send('scheduler:execute-action', {task, executionId: attemptId});
                });
              });
              success = executed;
              outcomeMsg = executed ? 'Scheduled chat directive processed by renderer' : 'Renderer dispatch timed out';
            }

          } else {
            // Unknown or unsupported action type -> FAIL SAFELY (never pretend it succeeded)
            success = false;
            outcomeMsg = `Unsupported action_type: '${actionType}'. Task rejected safely.`;
          }
        } catch (execErr: any) {
          success = false;
          outcomeMsg = `Execution error: ${String(execErr?.message || execErr).slice(0, 200)}`;
          void diagnosticLog('scheduler', outcomeMsg);
        }

        // 3. Persist completion record to durable outbox BEFORE network delivery
        const completionPayload: OutboxPayload = {
          idempotency_key: attemptId,
          run_id: runId,
          attempt_id: attemptId,
          device_id: DEVICE_ID,
          success,
          outcome: outcomeMsg,
          error: success ? null : outcomeMsg
        };
        await outbox.enqueue(attemptId, task.id, runId, DEVICE_ID, completionPayload);

        // 4. Attempt immediate delivery to worker
        try {
          const compRes = await net.fetch(baseUrl + '/tasks/' + task.id + '/complete', {
            method: 'POST',
            headers,
            body: JSON.stringify(completionPayload)
          } as any);

          let compData: any = null;
          try { compData = await compRes.json(); } catch {}

          if (compRes.ok && compData?.ok === true) {
            await outbox.remove(attemptId);
            void diagnosticLog('scheduler', `Task ${task.id} attempt ${attemptId} completion acknowledged by worker`);
          } else if (compRes.status === 400 || compRes.status === 404 || compRes.status === 409) {
            const permanent = compData?.already_completed || ['stale_execution', 'lease_expired', 'device_mismatch', 'execution_not_found'].includes(compData?.reason);
            if (permanent) {
              await outbox.remove(attemptId);
            } else {
              await outbox.recordFailure(attemptId, `Worker rejected: ${compData?.reason || compRes.status}`);
            }
          } else {
            await outbox.recordFailure(attemptId, `Worker error (${compRes.status})`);
          }
        } catch (repErr: any) {
          await outbox.recordFailure(attemptId, `Network delivery error: ${repErr?.message}`);
          void diagnosticLog('scheduler', `Completion reporting network error for ${task.id}: ${repErr?.message}; saved to durable outbox`);
        }
      }
    } finally {
      isPolling = false;
    }
  }

  // Start polling after a boot delay to allow application initialization
  setTimeout(() => {
    void pollOnce();
    setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  }, 8_000);
}

app.whenReady().then(() => {
  const broadcast = (status: string, payload: unknown = {}) =>
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('updates:status', {status, payload});
    });

  if (app.isPackaged && process.platform === 'win32') {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('update-available', info => broadcast('available', {version: info.version}));
    autoUpdater.on('update-not-available', () => broadcast('latest'));
    autoUpdater.on('download-progress', progress => broadcast('downloading', {percent: Math.round(progress.percent)}));
    autoUpdater.on('update-downloaded', info => broadcast('downloaded', {version: info.version}));
    autoUpdater.on('error', err => broadcast('error', {message: String(err.message).slice(0, 180)}));
    ipcMain.handle('updates:check', async () => {
      try {
        await autoUpdater.checkForUpdates();
        return {status: 'checking'};
      } catch (e) {
        return {status: 'error', message: String(e)};
      }
    });
    ipcMain.handle('updates:download', async () => {
      await autoUpdater.downloadUpdate();
      return {status: 'downloading'};
    });
    ipcMain.handle('updates:install', () => {
      autoUpdater.quitAndInstall(false, true);
      return {status: 'installing'};
    });
  } else {
    ipcMain.handle('updates:check', () => ({status: 'unavailable', message: 'Updates are enabled only in a packaged Windows installer'}));
  }

  if (!dev) {
    protocol.handle('irfan', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'studio') return new Response('Forbidden', {status: 403});
      const root = path.resolve(process.resourcesPath, 'ui');
      let requested = decodeURIComponent(url.pathname);
      if (requested.endsWith('/')) requested += 'index.html';
      const target = path.resolve(root, '.' + requested);
      if (target !== root && !target.startsWith(root + path.sep)) return new Response('Forbidden', {status: 403});
      return net.fetch(pathToFileURL(target).toString());
    });
  }

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));

  const credentialsFile = path.join(app.getPath('userData'), 'credentials.enc');
  const encryptionReady = () => safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text');

  ipcMain.handle('diagnostics:desktop', async () => {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((x): x is string => Boolean(x));
    const exists = async (file: string) => fs.access(file).then(() => true).catch(() => false);
    const browserCandidates = roots.flatMap(r => [
      path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')
    ]);
    const present = await Promise.all(browserCandidates.map(exists));
    let ffmpeg = false;
    try {
      const r = spawnSync('ffmpeg', ['-version'], {timeout: 5000, windowsHide: true, encoding: 'utf8'});
      ffmpeg = r.status === 0;
    } catch {}
    const uiPresent = dev || await exists(path.join(process.resourcesPath, 'ui', 'index.html'));
    return {
      platform: process.platform,
      packaged: app.isPackaged,
      uiPresent,
      encryptedStorage: encryptionReady(),
      browserAvailable: present.some(Boolean),
      ffmpegAvailable: ffmpeg,
      featureNotes: {
        whatsapp: 'Runs in a user-approved Windows browser session; scan QR from the Jarvis-only WhatsApp number',
        gmail: 'Requires Google OAuth configured on the backend and an authorized client account',
        mobile: 'Requires deployed backend plus one-time secure pairing to the phone',
        voice: 'Offline wake word running via local Windows acoustic detector; local speech synthesis active'
      }
    };
  });

  ipcMain.handle('settings:load', async () => {
    const isDev = process.env.IRFAN_DEV === '1';
    let devToken = '';
    if (isDev) {
      try {
        const devVarsPath = path.resolve(__dirname, '../../../services/worker/.dev.vars');
        const content = await fs.readFile(devVarsPath, 'utf8');
        const match = content.match(/APP_TOKEN=([a-f0-9]+)/i);
        if (match) devToken = match[1];
      } catch {}
    }
    if (!encryptionReady()) return {status: 'unavailable', isDev, defaultDevApi: 'http://127.0.0.1:8787', token: devToken};
    try {
      const bytes = await fs.readFile(credentialsFile);
      const data = JSON.parse(safeStorage.decryptString(bytes));
      return {status: 'loaded', apiUrl: data.apiUrl || '', token: data.token || devToken, isDev, defaultDevApi: 'http://127.0.0.1:8787'};
    } catch {
      return {status: 'empty', isDev, defaultDevApi: 'http://127.0.0.1:8787', token: devToken};
    }
  });

  ipcMain.handle('settings:save', async (_event, {apiUrl, token}: {apiUrl: string; token: string}) => {
    if (!encryptionReady()) throw Error('OS-backed secure credential storage is unavailable; settings remain session-only');
    if (typeof apiUrl !== 'string' || apiUrl.length > 300 || (!/^https:\/\//i.test(apiUrl) && !/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(apiUrl))) {
      throw Error('Backend URL must be HTTPS or local development');
    }
    if (typeof token !== 'string' || token.length < 32 || token.length > 1024) throw Error('Access token must be at least 32 characters');
    await fs.mkdir(path.dirname(credentialsFile), {recursive: true});
    await fs.writeFile(credentialsFile, safeStorage.encryptString(JSON.stringify({apiUrl, token})), {mode: 0o600});
    return {status: 'saved'};
  });

  ipcMain.handle('external:open', async (_event, link: string) => {
    const u = new URL(link);
    const isGoogle = u.protocol === 'https:' && u.hostname === 'accounts.google.com';
    const isFal = u.protocol === 'https:' && (u.hostname === 'fal.media' || u.hostname.endsWith('.fal.media'));
    if (!isGoogle && !isFal) throw Error('External URL is not allowlisted');
    return shell.openExternal(u.toString());
  });

  ipcMain.handle('window:showAndFocus', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.setAlwaysOnTop(true);
      setTimeout(() => {
        if (!win.isDestroyed()) win.setAlwaysOnTop(false);
      }, 500);
      return {ok: true};
    }
    return {ok: false};
  });

  ipcMain.handle('window:maximize', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.maximize();
      win.show();
      win.focus();
      return {ok: true};
    }
    return {ok: false};
  });

  ipcMain.handle('window:minimize', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.minimize();
      return {ok: true};
    }
    return {ok: false};
  });

  // Windows Application Lifecycle & Tray IPC Handlers
  ipcMain.handle('lifecycle:get-settings', () => ({
    backgroundMode,
    micEnabled,
    startWithWindows: app.getLoginItemSettings().openAtLogin,
    currentStatus: currentVoiceStatus
  }));

  ipcMain.handle('lifecycle:set-background-mode', (_e, {enabled}: {enabled: boolean}) => {
    backgroundMode = Boolean(enabled);
    void saveLifecycleSettings();
    updateTrayMenu();
    return {ok: true, backgroundMode};
  });

  ipcMain.handle('lifecycle:set-mic-enabled', (_e, {enabled}: {enabled: boolean}) => {
    micEnabled = Boolean(enabled);
    void saveLifecycleSettings();
    updateTrayMenu();
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('lifecycle:mic-toggled', {enabled: micEnabled});
    });
    return {ok: true, micEnabled};
  });

  ipcMain.handle('lifecycle:set-autolaunch', (_e, {enabled}: {enabled: boolean}) => {
    app.setLoginItemSettings({
      openAtLogin: Boolean(enabled),
      path: process.execPath,
      args: ['--hidden']
    });
    updateTrayMenu();
    return {ok: true, startWithWindows: app.getLoginItemSettings().openAtLogin};
  });

  ipcMain.handle('lifecycle:update-status', (_e, {status}: {status: string}) => {
    if (typeof status === 'string' && status.length < 50) {
      currentVoiceStatus = status;
      updateTrayMenu();
    }
    return {ok: true};
  });

  ipcMain.handle('lifecycle:quit', () => {
    isQuitting = true;
    app.quit();
    return {ok: true};
  });

  // Power Monitor: Windows Sleep and Wake Handlers
  powerMonitor.on('suspend', () => {
    void diagnosticLog('power', 'System suspending; pausing audio capture and wake detection');
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('power:suspend');
    });
  });

  powerMonitor.on('resume', () => {
    void diagnosticLog('power', 'System resumed; reinitializing wake detector safely');
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('power:resume');
    });
  });

  // Priority 8: Register Global Push-to-Talk shortcut across Windows
  try {
    const registeredAltM = globalShortcut.register('Alt+M', () => {
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
          w.webContents.send('irfan:global-ptt');
        }
      });
    });
    const registeredCtrlSpace = globalShortcut.register('CommandOrControl+Space', () => {
      BrowserWindow.getAllWindows().forEach(w => {
        if (!w.isDestroyed()) {
          if (w.isMinimized()) w.restore();
          w.show();
          w.focus();
          w.webContents.send('irfan:global-ptt');
        }
      });
    });
    console.log('[JARVIS] Global Push-to-Talk shortcuts registered:', {altM: registeredAltM, ctrlSpace: registeredCtrlSpace});
  } catch (err) {
    console.warn('[JARVIS] Global shortcut registration error:', err);
  }

  // Second-instance: restore and focus window when user attempts to launch second copy
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });

  // Initialize System Tray and Load Settings
  void loadLifecycleSettings().then(() => {
    try {
      tray = new Tray(getTrayIcon());
      tray.on('click', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          if (!win.isVisible()) win.show();
          win.focus();
          updateTrayMenu();
        } else {
          createWindow();
        }
      });
      tray.on('double-click', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          if (win.isMinimized()) win.restore();
          if (!win.isVisible()) win.show();
          win.focus();
          updateTrayMenu();
        }
      });
      updateTrayMenu();
    } catch (e) {
      console.warn('[JARVIS] System tray initialization error:', e);
    }
  });

  attachLocalAgent();
  attachWhatsApp();
  createWindow();

  // ── Scheduler: Poll worker for due tasks every 60 seconds ──────────────────
  // The desktop app is the execution target for tasks with execution_target 'any' or 'pc'.
  // When a task is due, we claim it (idempotent) then dispatch it to the renderer
  // via IPC, which executes the action using the local-tools IPC handlers.
  void startSchedulerPoller(credentialsFile);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void getBrowserService().close();
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
});

app.on('window-all-closed', () => {
  if (!backgroundMode || isQuitting) {
    if (process.platform !== 'darwin') app.quit();
  }
});
