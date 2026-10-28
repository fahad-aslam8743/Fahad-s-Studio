import path from 'node:path';
import fs from 'node:fs';
import {app} from 'electron';
import puppeteer, {Browser, Page} from 'puppeteer-core';

export interface BrowserSearchResult {
  title: string;
  url: string;
  status: 'opened' | 'playing' | 'searched';
  playbackTime?: number;
  snippet?: string;
  error?: string;
}

export class BrowserService {
  private browser: Browser | null = null;
  private activePage: Page | null = null;
  private persistentProfileDir: string;

  constructor() {
    this.persistentProfileDir = path.join(app.getPath('userData'), 'jarvis-chrome-profile');
    try {
      fs.mkdirSync(this.persistentProfileDir, {recursive: true});
    } catch {}
  }

  private findInstalledBrowser(): string | null {
    if (process.platform !== 'win32') return null;
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter((v): v is string => Boolean(v));
    const candidates = [
      ...roots.map(r => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map(r => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    ];
    return candidates.find(p => fs.existsSync(p)) || null;
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    const executablePath = this.findInstalledBrowser();
    if (!executablePath) {
      throw new Error('Neither Google Chrome nor Microsoft Edge was found on this Windows PC. Please install Chrome or Edge.');
    }

    this.browser = await puppeteer.launch({
      executablePath,
      headless: false, // Must be visible to user per requirements
      defaultViewport: null,
      userDataDir: this.persistentProfileDir,
      args: [
        '--no-first-run',
        '--no-default-browser-check',
        '--start-maximized',
        '--disable-blink-features=AutomationControlled'
      ],
      ignoreDefaultArgs: ['--enable-automation']
    });

    this.browser.on('disconnected', () => {
      this.browser = null;
      this.activePage = null;
    });

    return this.browser;
  }

  private async getPage(): Promise<Page> {
    const browser = await this.getBrowser();
    const pages = await browser.pages();
    // Prefer the active or latest page
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }
    const page = pages[pages.length - 1] || await browser.newPage();
    this.activePage = page;
    return page;
  }

  public async openOrFocusWhatsApp(): Promise<{status: string; url: string; title: string}> {
    const browser = await this.getBrowser();
    const pages = await browser.pages();
    for (const p of pages) {
      const u = p.url();
      if (/web\.whatsapp\.com/i.test(u)) {
        await p.bringToFront().catch(() => {});
        this.activePage = p;
        return {status: 'opened', url: u, title: 'WhatsApp Web'};
      }
    }
    return this.openWebsite('https://web.whatsapp.com');
  }

  public async openOrFocusGmail(): Promise<{status: string; url: string; title: string}> {
    const browser = await this.getBrowser();
    const pages = await browser.pages();
    for (const p of pages) {
      const u = p.url();
      if (/mail\.google\.com/i.test(u)) {
        await p.bringToFront().catch(() => {});
        this.activePage = p;
        return {status: 'opened', url: u, title: 'Gmail'};
      }
    }
    return this.openWebsite('https://mail.google.com');
  }

  public async openWebsite(url: string): Promise<{status: string; url: string; title: string}> {
    const page = await this.getPage();
    const targetUrl = /^https?:\/\//i.test(url) ? url : 'https://' + url;
    await page.goto(targetUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
    const title = await page.title().catch(() => targetUrl);
    await page.bringToFront().catch(() => {});
    return {status: 'opened', url: page.url(), title};
  }

  public async searchGoogle(query: string): Promise<{status: string; query: string; title: string; topResults: Array<{title: string; url: string}>}> {
    const page = await this.getPage();
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.bringToFront().catch(() => {});
    const title = await page.title().catch(() => query);

    const topResults = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('h3')).slice(0, 5);
      return links.map(h3 => {
        const anchor = h3.closest('a');
        return {
          title: h3.innerText || '',
          url: anchor ? anchor.href : ''
        };
      }).filter(r => Boolean(r.title && r.url));
    }).catch(() => []);

    return {status: 'searched', query, title, topResults};
  }

  public async searchYouTube(query: string): Promise<{status: string; query: string; results: Array<{title: string; url: string}>}> {
    const page = await this.getPage();
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    await page.goto(searchUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.bringToFront().catch(() => {});

    // Wait a brief moment for video items to hydrate
    await new Promise(r => setTimeout(r, 1500));

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('ytd-video-renderer a#video-title, #contents ytd-video-renderer a#video-title')).slice(0, 6);
      return items.map(a => ({
        title: ((a as HTMLElement).innerText || a.getAttribute('title') || '').trim(),
        url: (a as HTMLAnchorElement).href || ''
      })).filter(x => Boolean(x.title && x.url));
    }).catch(() => []);

    return {status: 'searched', query, results};
  }

  public async playYouTube(songOrQuery: string): Promise<BrowserSearchResult> {
    const page = await this.getPage();
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(songOrQuery)}`;
    await page.goto(searchUrl, {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.bringToFront().catch(() => {});

    // Wait for video list to load
    await new Promise(r => setTimeout(r, 1800));

    // Find the first video result
    const targetVideo = await page.evaluate(() => {
      const item = document.querySelector('ytd-video-renderer a#video-title') as HTMLAnchorElement | null;
      if (item && item.href) {
        return {title: item.innerText || item.getAttribute('title') || 'YouTube Video', url: item.href};
      }
      return null;
    });

    if (!targetVideo) {
      return {
        title: songOrQuery,
        url: page.url(),
        status: 'searched',
        error: `Could not identify a playable video result for "${songOrQuery}". Search results page remains open.`
      };
    }

    // Navigate to the video page
    await page.goto(targetVideo.url, {waitUntil: 'domcontentloaded', timeout: 30000});
    await page.bringToFront().catch(() => {});

    // Wait for video element and initiate playback
    await new Promise(r => setTimeout(r, 1500));

    const playback = await page.evaluate(async () => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      if (!v) return {hasVideo: false, paused: true, currentTime: 0};
      
      // Attempt play if paused
      if (v.paused) {
        try {
          await v.play();
        } catch {}
      }
      return {
        hasVideo: true,
        paused: v.paused,
        currentTime: Math.round(v.currentTime),
        duration: Math.round(v.duration || 0)
      };
    }).catch(() => ({hasVideo: false, paused: true, currentTime: 0}));

    const finalTitle = await page.title().catch(() => targetVideo.title);

    return {
      title: finalTitle.replace(/- YouTube$/i, '').trim(),
      url: page.url(),
      status: playback.hasVideo && !playback.paused ? 'playing' : 'opened',
      playbackTime: playback.currentTime
    };
  }

  public async inspectPage(mode: 'summary' | 'search' | 'tabs', searchPhrase?: string): Promise<Record<string, unknown>> {
    const page = await this.getPage();
    const title = await page.title().catch(() => '');
    const url = page.url();

    if (mode === 'tabs') {
      const browser = await this.getBrowser();
      const pages = await browser.pages();
      const tabList = await Promise.all(pages.map(async (p, idx) => ({
        index: idx,
        title: await p.title().catch(() => 'Untitled'),
        url: p.url(),
        active: p === page
      })));
      return {title, url, tabs: tabList};
    }

    if (mode === 'search' && searchPhrase) {
      const occurrences = await page.evaluate((term: string) => {
        const text = document.body ? document.body.innerText : '';
        const regex = new RegExp(term, 'gi');
        const matches = text.match(regex);
        return {
          term,
          matchCount: matches ? matches.length : 0,
          sample: text.slice(0, 800)
        };
      }, searchPhrase).catch(() => ({term: searchPhrase, matchCount: 0, sample: ''}));
      return {title, url, ...occurrences};
    }

    // Default: bounded text summary
    const textSnippet = await page.evaluate(() => {
      if (!document.body) return '';
      // Exclude script and style text
      const clone = document.body.cloneNode(true) as HTMLElement;
      const scripts = clone.querySelectorAll('script, style, noscript, svg');
      scripts.forEach(s => s.remove());
      const raw = clone.innerText || '';
      return raw.replace(/\s+/g, ' ').trim().slice(0, 2500);
    }).catch(() => '');

    return {
      title,
      url,
      summary: textSnippet.slice(0, 1500),
      characterCount: textSnippet.length
    };
  }

  public async navigate(action: 'back' | 'forward' | 'reload' | 'new_tab' | 'close_tab', url?: string): Promise<{status: string; currentUrl: string}> {
    const browser = await this.getBrowser();
    const page = await this.getPage();

    switch (action) {
      case 'back':
        await page.goBack().catch(() => {});
        break;
      case 'forward':
        await page.goForward().catch(() => {});
        break;
      case 'reload':
        await page.reload().catch(() => {});
        break;
      case 'new_tab': {
        const newP = await browser.newPage();
        this.activePage = newP;
        if (url) {
          await newP.goto(/^https?:\/\//i.test(url) ? url : 'https://' + url, {waitUntil: 'domcontentloaded'});
        }
        break;
      }
      case 'close_tab': {
        await page.close().catch(() => {});
        const remaining = await browser.pages();
        this.activePage = remaining[remaining.length - 1] || null;
        break;
      }
    }

    const cur = this.activePage && !this.activePage.isClosed() ? this.activePage.url() : 'about:blank';
    return {status: 'ok', currentUrl: cur};
  }

  public async close(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
      this.activePage = null;
    }
  }
}

let browserServiceInstance: BrowserService | null = null;
export function getBrowserService(): BrowserService {
  if (!browserServiceInstance) {
    browserServiceInstance = new BrowserService();
  }
  return browserServiceInstance;
}
