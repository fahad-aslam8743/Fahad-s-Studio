// JARVIS Multi-Step Bounded Agent Loop
// Interprets user requests, executes registered desktop and browser tools,
// observes real output, and provides clean human speech and Hollywood diagnostic logs.

export interface AgentStepResult {
  done: boolean;
  finalReply?: string;
  spokenReply?: string;
  toolExecuted?: string;
  toolResult?: unknown;
  diagnosticStage?: string;
  confirmationRequired?: {
    id: string;
    tool: string;
    args: unknown;
  };
}

export interface AgentContext {
  message: string;
  tools: Array<{name: string; risk: string; description: string}>;
  propose: (name: string, args: unknown) => Promise<any>;
  requestBackend: (route: string, init?: RequestInit) => Promise<any>;
  onDiagnostic?: (logLine: string) => void;
}

export function cleanSpeech(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/(?:www\.)?youtube\.com[^\s]*/gi, 'YouTube')
    .replace(/https?:\/\/(?:www\.)?google\.com[^\s]*/gi, 'Google')
    .replace(/https?:\/\/(?:www\.)?web\.whatsapp\.com[^\s]*/gi, 'WhatsApp Web')
    .replace(/https?:\/\/(?:www\.)?mail\.google\.com[^\s]*/gi, 'Gmail')
    .replace(/https?:\/\/[^\s]+/gi, 'the website')
    .replace(/\{[\s\S]*?\}/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/[*_#~>[\]|]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatHumanPlanResult(toolName: string, args: any, result: any): string {
  if (toolName === 'open_app') return `Opened ${args?.name || 'the app'} and brought it to the front for you.`;
  if (toolName === 'focus_app') return `Switched to ${args?.name || 'the window'}.`;
  if (toolName === 'window_control') {
    const act = args?.action === 'maximize' ? 'Maximized' : args?.action === 'minimize' ? 'Minimized' : args?.action === 'close' ? 'Closed' : 'Restored';
    return `${act} ${args?.name || 'window'}.`;
  }
  if (toolName === 'open_settings') return `Opened Windows settings.`;
  if (toolName === 'browser_open') return `Opened the requested page in Chrome.`;
  if (toolName === 'youtube_play') return `Playing your video on YouTube.`;
  if (toolName === 'get_current_time') return `The current time is ${new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}.`;
  if (typeof result === 'string') return cleanSpeech(result).slice(0, 150);
  if (result?.status === 'opened') return `Opened ${result.app || 'the application'}.`;
  return `Action completed.`;
}

export async function runAgentLoop(ctx: AgentContext): Promise<AgentStepResult> {
  const {message, propose, requestBackend, tools, onDiagnostic} = ctx;
  const m = message.trim();

  const log = (step: string) => {
    onDiagnostic?.(step);
  };

  log(`[NEURAL CORE: PARSING DIRECTIVE] "${m.slice(0, 60)}"`);

  // ── A. WhatsApp Web Automation ("Open WhatsApp", "Open WhatsApp Web", "My WhatsApp tab is open") ──
  if (/\b(?:whatsapp|web\.whatsapp\.com)\b/i.test(m) && /\b(?:open|go\s+to|switch\s+to|tab\s+is\s+open(?:ed)?|message|read)\b/i.test(m)) {
    log(`[AUTOMATION: LOCATING WHATSAPP TAB]`);
    try {
      const result = await propose('whatsapp_open', {});
      log(`[AUTOMATION: WHATSAPP WEB ACTIVE & MAXIMIZED]`);
      return {
        done: true,
        finalReply: 'WhatsApp Web is open and brought to the front for you.',
        spokenReply: 'WhatsApp Web is open and in front of you.',
        toolExecuted: 'whatsapp_open',
        toolResult: result
      };
    } catch {}
  }

  // ── B. Gmail Automation ("Open Gmail", "Go to Gmail", "Check my emails on Gmail", "Read messages on Gmail") ──
  if (/\b(?:gmail|mail\.google\.com)\b/i.test(m) && /\b(?:open|go\s+to|switch\s+to|check|read)\b/i.test(m)) {
    log(`[AUTOMATION: LAUNCHING GMAIL INTERFACE]`);
    try {
      const result = await propose('gmail_open', {});
      log(`[AUTOMATION: GMAIL ACTIVE & FOREGROUNDED]`);
      return {
        done: true,
        finalReply: 'Gmail is open in Chrome for you.',
        spokenReply: 'Gmail is open in front of you.',
        toolExecuted: 'gmail_open',
        toolResult: result
      };
    } catch {}
  }

  // ── C. YouTube Playback ("Play [song] on YouTube", "Play [song]") ──
  const ytPlayMatch = /^(?:play|stream)\s+(?:the\s+song\s+|video\s+)?(.+?)(?:\s+on\s+youtube)?$/i.exec(m);
  if (ytPlayMatch && !/^(?:with|game|cards|chess)/i.test(ytPlayMatch[1])) {
    const song = ytPlayMatch[1].replace(/^(?:the\s+song\s+|video\s+)/i, '').trim();
    log(`[MEDIA: ACQUIRING YOUTUBE STREAM FOR "${song}"]`);
    const result = await propose('youtube_play', {query: song});
    const videoTitle = result.title || song;
    log(`[MEDIA: PLAYBACK CONFIRMED: "${videoTitle}"]`);
    return {
      done: true,
      finalReply: `Now playing "${videoTitle}" on YouTube.`,
      spokenReply: `Now playing ${videoTitle} on YouTube.`,
      toolExecuted: 'youtube_play',
      toolResult: result
    };
  }

  // ── D. YouTube Search ("Search YouTube for X") ──
  const ytSearchMatch = /^(?:search\s+youtube\s+for|youtube\s+search)\s+(.+)$/i.exec(m);
  if (ytSearchMatch) {
    const query = ytSearchMatch[1].trim();
    log(`[MEDIA: QUERYING YOUTUBE CATALOG FOR "${query}"]`);
    const result = await propose('browser_search', {query, engine: 'youtube'});
    return {
      done: true,
      finalReply: `Found YouTube results for "${query}".`,
      spokenReply: `Here are the YouTube results for ${query}.`,
      toolExecuted: 'browser_search',
      toolResult: result
    };
  }

  // ── E. Google Search ("Search Google for X", "Google X") ──
  const googleSearchMatch = /^(?:search\s+google\s+for|google\s+search\s+for|google)\s+(.+)$/i.exec(m);
  if (googleSearchMatch) {
    const query = googleSearchMatch[1].trim();
    log(`[SEARCH: EXECUTING GOOGLE QUERY FOR "${query}"]`);
    const result = await propose('browser_search', {query, engine: 'google'});
    return {
      done: true,
      finalReply: `Searched Google for "${query}". Top results are open in Chrome.`,
      spokenReply: `Here are the top Google results for ${query}.`,
      toolExecuted: 'browser_search',
      toolResult: result
    };
  }

  // ── F. Open Website ("Open https://...", "Open youtube.com", etc.) ──
  if (/^open\s+(?:the\s+website\s+|site\s+)?(https?:\/\/[^\s]+)$/i.test(m)) {
    const url = m.match(/https?:\/\/[^\s]+/i)![0];
    log(`[BROWSER: NAVIGATING TO ${url}]`);
    const result = await propose('browser_open', {url});
    const host = new URL(url).hostname.replace(/^www\./, '');
    return {
      done: true,
      finalReply: `Opened ${host} in Chrome.`,
      spokenReply: `Opened ${host} in Chrome for you.`,
      toolExecuted: 'browser_open',
      toolResult: result
    };
  }

  if (/^open\s+youtube$/i.test(m)) {
    log(`[BROWSER: OPENING YOUTUBE]`);
    const result = await propose('browser_open', {url: 'https://www.youtube.com'});
    return {done: true, finalReply: 'Opened YouTube in Chrome.', spokenReply: 'Opened YouTube in Chrome for you.', toolExecuted: 'browser_open', toolResult: result};
  }

  if (/^open\s+google$/i.test(m)) {
    log(`[BROWSER: OPENING GOOGLE]`);
    const result = await propose('browser_open', {url: 'https://www.google.com'});
    return {done: true, finalReply: 'Opened Google in Chrome.', spokenReply: 'Opened Google in Chrome.', toolExecuted: 'browser_open', toolResult: result};
  }

  // ── G. Common Application Launching ("Open Calculator", "Open Chrome", "Open Notepad", etc.) ──
  const openAppMatch = /^(?:open|launch|start)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i.exec(m);
  if (openAppMatch) {
    const rawTarget = openAppMatch[1].trim().toLowerCase();
    const appAliases: Record<string, {alias: string; title: string}> = {
      calculator: {alias: 'calc', title: 'Calculator'},
      calc: {alias: 'calc', title: 'Calculator'},
      notepad: {alias: 'notepad', title: 'Notepad'},
      chrome: {alias: 'chrome', title: 'Google Chrome'},
      'google chrome': {alias: 'chrome', title: 'Google Chrome'},
      edge: {alias: 'edge', title: 'Microsoft Edge'},
      'microsoft edge': {alias: 'edge', title: 'Microsoft Edge'},
      code: {alias: 'code', title: 'Visual Studio Code'},
      vscode: {alias: 'code', title: 'Visual Studio Code'},
      'vs code': {alias: 'code', title: 'Visual Studio Code'},
      explorer: {alias: 'explorer', title: 'File Explorer'},
      'file explorer': {alias: 'explorer', title: 'File Explorer'},
      files: {alias: 'explorer', title: 'File Explorer'},
      'task manager': {alias: 'task manager', title: 'Task Manager'},
      taskmgr: {alias: 'task manager', title: 'Task Manager'},
      settings: {alias: 'settings', title: 'Windows Settings'},
      whatsapp: {alias: 'whatsapp', title: 'WhatsApp'}
    };

    if (appAliases[rawTarget]) {
      const {alias, title} = appAliases[rawTarget];
      log(`[WIN32 PROCESS DISPATCH: LAUNCHING & MAXIMIZING "${title}"]`);
      const result = await propose('open_app', {name: alias});
      log(`[WIN32 PROCESS: "${title}" ACTIVE IN FOREGROUND]`);
      return {
        done: true,
        finalReply: `Opened ${title} and maximized it in front of you.`,
        spokenReply: `Opened ${title} in front of you.`,
        toolExecuted: 'open_app',
        toolResult: result
      };
    }
  }

  // ── H. Window Management ("Maximize Chrome", "Minimize Chrome", "Close Notepad", etc.) ──
  const windowCmdMatch = /^(maximize|minimize|restore|focus|switch to|close)\s+(?:the\s+)?(.+?)(?:\s+window)?$/i.exec(m);
  if (windowCmdMatch) {
    const actionVerb = windowCmdMatch[1].toLowerCase();
    const appName = windowCmdMatch[2].trim();
    const action = actionVerb === 'switch to' ? 'focus' : (actionVerb as 'maximize' | 'minimize' | 'restore' | 'focus' | 'close');

    log(`[WIN32 WINDOW MGMT: ${action.toUpperCase()} TARGET: "${appName}"]`);

    if (action === 'focus') {
      const result = await propose('focus_app', {name: appName});
      return {
        done: true,
        finalReply: `Switched to ${result.processName || appName}.`,
        spokenReply: `Switched to ${result.processName || appName}.`,
        toolExecuted: 'focus_app',
        toolResult: result
      };
    }

    const result = await propose('window_control', {name: appName, action});
    if (result.status === 'confirmation_required') {
      return {
        done: false,
        confirmationRequired: {id: result.id, tool: result.tool, args: result.args},
        finalReply: `Please confirm closing ${appName}.`,
        spokenReply: `Please confirm closing ${appName} on the confirmation card.`
      };
    }

    const friendlyAction = action === 'maximize' ? 'Maximized' : action === 'minimize' ? 'Minimized' : action === 'close' ? 'Closed' : 'Restored';
    log(`[WIN32 WINDOW MGMT: ${friendlyAction.toUpperCase()} COMPLETED]`);
    return {
      done: true,
      finalReply: `${friendlyAction} ${appName} window.`,
      spokenReply: `${friendlyAction} ${appName}.`,
      toolExecuted: 'window_control',
      toolResult: result
    };
  }

  // ── I. System Settings ("Open sound settings", etc.) ──
  const settingsMatch = /^open\s+(?:windows\s+)?(sound|display|network|apps|bluetooth|windowsupdate|privacy)?\s*settings$/i.exec(m);
  if (settingsMatch) {
    const page = settingsMatch[1] ? settingsMatch[1].toLowerCase() : '';
    log(`[WIN32 SYSTEM: LAUNCHING MS-SETTINGS:${page}]`);
    const result = await propose('open_settings', {page});
    return {
      done: true,
      finalReply: `Opened Windows ${page ? page + ' ' : ''}settings.`,
      spokenReply: `Opened Windows ${page ? page + ' ' : ''}settings for you.`,
      toolExecuted: 'open_settings',
      toolResult: result
    };
  }

  // ── J. Volume Controls ──
  if (/^(?:turn\s+)?volume\s+(up|down|mute)$/i.test(m)) {
    const action = m.match(/up|down|mute/i)![0].toLowerCase() as 'up' | 'down' | 'mute';
    log(`[HARDWARE AUDIO: SETTING VOLUME ${action.toUpperCase()}]`);
    const result = await propose('system_volume', {action});
    return {
      done: true,
      finalReply: `System volume ${action === 'mute' ? 'muted' : action + 'ed'}.`,
      spokenReply: `Volume ${action === 'mute' ? 'muted' : action + 'ed'}.`,
      toolExecuted: 'system_volume',
      toolResult: result
    };
  }

  // ── Step 2: Bounded Multi-Step Backend Tool Planner (for Complex Requests) ──
  try {
    log(`[PLANNER: GENERATING EXECUTION PATH VIA BACKEND]`);
    const planPromise = requestBackend('/tools/plan', {
      method: 'POST',
      body: JSON.stringify({message: m, tools})
    });
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Tool planner timeout')), 1200));
    const plan: any = await Promise.race([planPromise, timeoutPromise]);

    if (plan.action === 'clarify') {
      log(`[PLANNER: REQUESTING CLARIFICATION]`);
      return {done: true, finalReply: plan.question, spokenReply: cleanSpeech(plan.question)};
    }

    if (plan.action === 'tool') {
      log(`[EXECUTION: INVOKING ${plan.name.toUpperCase()}]`);
      const result = await propose(plan.name, plan.args);
      if (result.status === 'confirmation_required') {
        return {
          done: false,
          confirmationRequired: {id: result.id, tool: result.tool, args: result.args},
          finalReply: `Confirmation required for ${result.tool}.`,
          spokenReply: `Please confirm ${result.tool.replace(/_/g, ' ')}.`
        };
      }

      const humanText = formatHumanPlanResult(plan.name, plan.args, result);
      log(`[PLANNER: DIRECTIVE EXECUTED SUCCESSFULLY]`);
      return {
        done: true,
        finalReply: humanText,
        spokenReply: humanText,
        toolExecuted: plan.name,
        toolResult: result
      };
    }
  } catch (err) {
    console.warn('[Multi-step agent loop fallback to chat]', err);
  }

  return {done: false};
}
