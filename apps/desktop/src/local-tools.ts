import {spawn} from 'node:child_process';
import path from 'node:path';
import {app} from 'electron';
import {z} from 'zod';
import {toolInputSchemas} from './tool-schemas';
import {getBrowserService} from './browser-service';

export const specs = {
  list_installed_apps: z.object({}),
  open_app: z.object({name: z.string().min(1).max(120), selection: z.string().optional()}),
  focus_app: z.object({name: z.string().min(1).max(120).optional(), pid: z.number().int().positive().optional()}).refine(a => Boolean(a.name || a.pid), 'Provide app name or PID'),
  open_settings: z.object({page: z.string().max(80).optional()}),
  list_running_apps: z.object({}),
  close_app: z.object({pid: z.number().int().positive().optional(), name: z.string().min(1).max(120).optional()}).refine(a => Boolean(a.pid || a.name), 'Provide a PID or application name'),
  window_control: z.object({
    pid: z.number().int().positive().optional(),
    name: z.string().min(1).max(120).optional(),
    action: z.enum(['minimize', 'maximize', 'restore', 'close', 'focus', 'left', 'right', 'monitor_next', 'minimize_all'])
  }),
  open_website: z.object({url: z.string().url().refine(x => /^https?:\/\//i.test(x))}),
  browser_open: z.object({url: z.string().min(1).max(2000)}),
  browser_search: z.object({query: z.string().min(1).max(500), engine: z.enum(['google', 'youtube']).default('google')}),
  youtube_play: z.object({query: z.string().min(1).max(500)}),
  browser_inspect: z.object({mode: z.enum(['summary', 'search', 'tabs']).default('summary'), query: z.string().max(200).optional()}),
  browser_nav: z.object({action: z.enum(['back', 'forward', 'reload', 'new_tab', 'close_tab']), url: z.string().optional()}),
  whatsapp_open: z.object({}),
  gmail_open: z.object({}),
  youtube_search: z.object({query: z.string().min(1).max(300), mode: z.enum(['results', 'first']).default('results')}),
  system_volume: z.object({action: z.enum(['up', 'down', 'mute'])}),
  screen_brightness: z.object({percent: z.number().int().min(0).max(100)}),
  system_radio: z.object({device: z.enum(['wifi', 'bluetooth', 'airplane']), enabled: z.boolean()}),
  dark_mode: z.object({enabled: z.boolean()}),
  lock_screen: z.object({}),
  sleep_pc: z.object({}),
  open_folder: z.object({path: z.string().min(1).max(1024)}),
  find_file: z.object({name: z.string().min(1).max(200), root: z.string().max(1024).optional()}),
  open_file: z.object({path: z.string().min(1).max(1024)}),
  move_file: z.object({source: z.string().min(1), destination: z.string().min(1)}),
  delete_file: z.object({path: z.string().min(1)}),
  screenshot: z.object({}),
  clipboard_read: z.object({}),
  clipboard_write: z.object({text: z.string().max(100000)}),
  ui_inspect: z.object({pid: z.number().int().positive(), limit: z.number().int().min(1).max(100).default(60)}),
  ui_automation: z.object({
    pid: z.number().int().positive(),
    automationId: z.string().min(1).max(160),
    expectedName: z.string().max(300).optional(),
    action: z.enum(['invoke', 'set_value', 'toggle']),
    value: z.string().max(1000).optional()
  })
} as const;

export type Name = keyof typeof specs;
export type Risk = 'SAFE' | 'CONFIRM' | 'BLOCKED';

// Consequential and destructive actions require explicit confirmation.
// Low-risk exploratory, reading, windowing, and browser actions are SAFE.
const confirm = new Set<Name>([
  'close_app',
  'sleep_pc',
  'lock_screen',
  'system_radio',
  'move_file',
  'delete_file',
  'screenshot',
  'clipboard_read',
  'clipboard_write',
  'ui_inspect',
  'ui_automation'
]);

const descriptions: Record<Name, string> = {
  list_installed_apps: 'Enumerate Start Menu application names and IDs',
  open_app: 'Launch an installed application (Chrome, Notepad, Calculator, VS Code, Explorer, WhatsApp, etc.)',
  focus_app: 'Bring a running application window to the foreground by name or PID',
  open_settings: 'Open specific Windows Settings pages (sound, display, network, apps, windowsupdate, etc.)',
  list_running_apps: 'List visible desktop processes and window titles',
  close_app: 'Politely close a running app by PID; requires confirmation',
  window_control: 'Control window state (minimize, maximize, restore, focus, left, right, monitor_next, minimize_all)',
  open_website: 'Open a URL in the default operating system browser',
  browser_open: 'Open any webpage in visible Google Chrome session with persistent JARVIS profile',
  browser_search: 'Search Google or YouTube in visible Google Chrome session',
  youtube_play: 'Search YouTube and initiate playback for requested song, video, or tutorial',
  browser_inspect: 'Inspect visible page text summary, search within page, or list browser tabs',
  browser_nav: 'Navigate active browser session (back, forward, reload, new_tab, close_tab)',
  whatsapp_open: 'Open or switch to WhatsApp Web tab in Chrome',
  gmail_open: 'Open or switch to Gmail tab in Chrome',
  youtube_search: 'Search YouTube in browser',
  system_volume: 'Change system audio volume (up, down, mute)',
  screen_brightness: 'Set built-in screen brightness (external monitors may not respond)',
  system_radio: 'Toggle Wi-Fi where available (requires admin)',
  dark_mode: 'Toggle Windows light/dark theme',
  lock_screen: 'Lock Windows desktop',
  sleep_pc: 'Request Windows sleep (requires confirmation)',
  open_folder: 'Open a local directory in File Explorer',
  find_file: 'Search for files by name under a local directory',
  open_file: 'Open a local file in its associated desktop application',
  move_file: 'Move a local file (requires confirmation)',
  delete_file: 'Move a file to Recycle Bin (requires confirmation)',
  screenshot: 'Capture desktop screenshot (requires confirmation)',
  clipboard_read: 'Read system clipboard (requires confirmation)',
  clipboard_write: 'Write text to system clipboard (requires confirmation)',
  ui_inspect: 'Inspect UI Automation control tree of a running process; requires confirmation',
  ui_automation: 'Execute native Windows UI Automation on an inspected control; requires confirmation'
};

export const definitions = (Object.keys(specs) as Name[]).map(name => ({
  name,
  description: descriptions[name],
  risk: (confirm.has(name) ? 'CONFIRM' : 'SAFE') as Risk,
  executor: 'local' as const,
  inputSchema: (toolInputSchemas as any)[name],
  requiresAdmin: name === 'system_radio'
}));

export async function runNative(name: Name, input: unknown): Promise<unknown> {
  const args = (specs[name] as any).parse(input);

  // 1. Browser automation tools route to BrowserService
  if (name === 'browser_open') {
    return getBrowserService().openWebsite(args.url);
  }
  if (name === 'whatsapp_open') {
    return getBrowserService().openOrFocusWhatsApp();
  }
  if (name === 'gmail_open') {
    return getBrowserService().openOrFocusGmail();
  }
  if (name === 'browser_search') {
    if (args.engine === 'youtube') {
      return getBrowserService().searchYouTube(args.query);
    }
    return getBrowserService().searchGoogle(args.query);
  }
  if (name === 'youtube_play') {
    return getBrowserService().playYouTube(args.query);
  }
  if (name === 'browser_inspect') {
    return getBrowserService().inspectPage(args.mode, args.query);
  }
  if (name === 'browser_nav') {
    return getBrowserService().navigate(args.action, args.url);
  }

  // 2. Windows native tools route to tools.ps1
  if (process.platform !== 'win32') {
    return Promise.resolve({
      mock: true,
      platform: process.platform,
      tool: name,
      args,
      message: 'Windows-only tool. No device action taken.'
    });
  }

  const script = app.isPackaged
    ? path.join(process.resourcesPath, 'scripts', 'tools.ps1')
    : path.join(__dirname, '../scripts/tools.ps1');

  return new Promise((resolve, reject) => {
    const proc = spawn('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script
    ], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => proc.kill(), 25000);

    proc.stdout.on('data', b => {
      stdout += b.toString();
      if (stdout.length > 500000) proc.kill();
    });

    proc.stderr.on('data', b => {
      stderr += b.toString();
      if (stderr.length > 100000) proc.kill();
    });

    proc.on('error', reject);

    proc.on('close', code => {
      clearTimeout(timeout);
      try {
        const o = JSON.parse(stdout.trim());
        if (code !== 0 || o.error) {
          reject(new Error(o.error || stderr || 'Tool failed'));
        } else {
          resolve(o);
        }
      } catch {
        reject(new Error((stderr || stdout || 'Native helper failed').slice(0, 1200)));
      }
    });

    proc.stdin.end(JSON.stringify({name, args}));
  });
}
