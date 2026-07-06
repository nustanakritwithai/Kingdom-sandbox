/* Save boot + continue flow — regression for empty UI after reload */
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '8921'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { await d.accept(); });

  await page.goto('http://127.0.0.1:8921/index.html', { waitUntil: 'networkidle0' });

  // Create world and save to localStorage
  const overlay1 = await page.evaluate(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  });
  if (overlay1) await page.evaluate(() => document.getElementById('btnNewWorldOverlay').click());
  await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 10000 });
  await page.evaluate(() => {
    simulateDay();
    simulateDay();
    SaveSystem.saveToLocalStorage('uitest', true);
  });

  // Full page reload — simulates user returning to site
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => {
    const ov = document.getElementById('continueOverlay');
    return ov && !ov.classList.contains('hidden');
  }, { timeout: 8000 });

  // Game loop must stay alive while overlay is shown (world still null)
  await new Promise(r => setTimeout(r, 500));
  const loopAlive = await page.evaluate(() => {
    const before = document.getElementById('dayCounter')?.textContent;
    return new Promise(resolve => {
      setTimeout(() => {
        const after = document.getElementById('dayCounter')?.textContent;
        resolve(before === after && before === 'Day —');
      }, 200);
    });
  });
  if (!loopAlive) throw new Error('UI loop died before continue');

  await page.evaluate(() => document.getElementById('btnContinueOverlay').click());
  await page.waitForFunction(() => world && world.settlements.length > 0, { timeout: 8000 });

  const state = await page.evaluate(() => ({
    day: world.day,
    settlements: world.settlements.length,
    agents: world.agents.filter(a => a.alive).length,
    inspector: document.getElementById('inspectorBody')?.innerHTML || '',
    log: document.getElementById('eventLog')?.innerHTML || '',
    dayCounter: document.getElementById('dayCounter')?.textContent || '',
    overlayHidden: document.getElementById('continueOverlay')?.classList.contains('hidden'),
    canvasHasPixels: (() => {
      const c = document.getElementById('mapCanvas');
      const ctx = c.getContext('2d');
      const d = ctx.getImageData(0, 0, Math.min(50, c.width), Math.min(50, c.height)).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) return true;
      return false;
    })()
  }));

  if (!state.overlayHidden) throw new Error('Continue overlay still visible');
  if (state.settlements < 1) throw new Error('No settlements after continue');
  if (state.agents < 1) throw new Error('No agents after continue');
  if (!state.dayCounter.includes('Day')) throw new Error('Day counter not updated: ' + state.dayCounter);
  if (!state.inspector.includes('สถานะโลก')) throw new Error('Inspector empty after continue');
  if (!state.log.length) throw new Error('Event log empty after continue');
  if (!state.canvasHasPixels) throw new Error('Map canvas blank after continue');
  if (errors.length) throw new Error('JS errors: ' + errors.join('; '));

  console.log('Save continue UI test PASSED — Day', state.day, 'settlements', state.settlements);
  await browser.close();
  server.kill();
})().catch(e => { console.error('UI test FAILED:', e.message); process.exit(1); });
