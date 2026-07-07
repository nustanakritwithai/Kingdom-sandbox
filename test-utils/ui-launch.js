/* Shared browser launcher for UI smoke tests (playwright-core preferred, puppeteer fallback) */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function tryRequire(name) {
  try { return require(name); } catch { return null; }
}

function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const base = '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

async function getBrowserLauncher() {
  const pw = tryRequire('playwright-core');
  if (pw?.chromium) {
    return {
      kind: 'playwright-core',
      async launch() {
        const exe = findChromium();
        return pw.chromium.launch({
          headless: true,
          executablePath: exe || undefined,
          args: ['--no-sandbox']
        });
      },
      async newPage(browser) { return browser.newPage({ viewport: { width: 1400, height: 900 } }); },
      async close(browser) { await browser.close(); }
    };
  }
  const puppeteer = tryRequire('puppeteer') || tryRequire('puppeteer-core');
  if (puppeteer) {
    return {
      kind: 'puppeteer',
      async launch() {
        const exe = findChromium();
        return puppeteer.launch({
          headless: true,
          executablePath: exe || undefined,
          args: ['--no-sandbox']
        });
      },
      async newPage(browser) {
        const page = await browser.newPage();
        await page.setViewport({ width: 1400, height: 900 });
        return page;
      },
      async close(browser) { await browser.close(); }
    };
  }
  return null;
}

function startStaticServer(port, rootDir) {
  const server = spawn('python3', ['-m', 'http.server', String(port)], {
    cwd: rootDir,
    stdio: 'ignore'
  });
  return server;
}

async function withBrowserTest(port, rootDir, fn) {
  const launcher = await getBrowserLauncher();
  if (!launcher) {
    return { status: 'SKIP', reason: 'playwright-core/puppeteer not installed' };
  }
  const exe = findChromium();
  if (!exe && launcher.kind === 'playwright-core') {
    // playwright may bundle browser; try anyway
  }
  const server = startStaticServer(port, rootDir);
  await new Promise(r => setTimeout(r, 900));
  let browser;
  try {
    browser = await launcher.launch();
    const page = await launcher.newPage(browser);
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    if (page.on) {
      page.on('console', m => {
        if (m.type && m.type() === 'error') errors.push(`console.error: ${m.text()}`);
      });
      page.on('dialog', async d => { try { await d.accept(); } catch {} });
    }
    await fn(page, errors);
    if (errors.length) {
      return { status: 'FAIL', reason: errors.join('; ') };
    }
    return { status: 'PASS' };
  } catch (e) {
    if (/Executable doesn't exist|browser.*not found|Could not find Chrome/i.test(e.message)) {
      return { status: 'SKIP', reason: 'browser not available: ' + e.message };
    }
    return { status: 'FAIL', reason: e.message };
  } finally {
    if (browser) await launcher.close(browser);
    server.kill();
  }
}

module.exports = {
  tryRequire,
  findChromium,
  getBrowserLauncher,
  startStaticServer,
  withBrowserTest
};
