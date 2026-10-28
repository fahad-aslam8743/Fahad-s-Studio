import {spawnSync} from 'node:child_process';
import {autoUpdater} from 'electron-updater';
import {app,BrowserWindow,ipcMain,protocol,net,session,shell,safeStorage,globalShortcut} from 'electron';
import {attachLocalAgent} from './local-agent';
import {attachWhatsApp} from './whatsapp';
import {getBrowserService} from './browser-service';
import path from 'node:path';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

const diagnosticLog = async (kind: string, message: string) => {
  const safe = message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').replace(/(?:key|token|secret|password)\s*[:=]\s*[^\s,]+/gi, 'credential=[REDACTED]').slice(0, 500);
  try {
    const file = path.join(app.getPath('userData'), 'desktop-errors.jsonl');
    await fs.appendFile(file, JSON.stringify({time: new Date().toISOString(), kind, message: safe}) + '\n', {mode: 0o600});
  } catch {}
};

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

  if (dev) void window.loadURL('http://localhost:3001');
  else void window.loadURL('irfan://studio/index.html');
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

  attachLocalAgent();
  attachWhatsApp();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void getBrowserService().close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
