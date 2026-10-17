// Run with Playwright available, or set PLAYWRIGHT_MODULE to an installed package path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'babymia-companion-'));
  const port = 23500 + Math.floor(Math.random() * 1000);
  const root = resolve(__dirname, '..'); const base = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory, ANDROID_UPDATE_ENABLED: 'false' }, stdio: 'ignore' });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { ready = (await fetch(base + '/api/status')).ok; } catch {} if (ready) break; await new Promise(r => setTimeout(r, 100)); }
    assert(ready, 'isolated test server must start');
    const setup = await fetch(base + '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify({ mutationId: randomUUID(), babyName: '测试宝宝', birthDate: new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10), caregiverName: '测试', password: 'local-test-pass' }) });
    assert.equal(setup.status, 201);
    browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || undefined, headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/api/videos', route => route.fulfill({ json: { directory_hint: 'test/videos', videos: Array.from({ length: 227 }, (_, i) => ({ id: `video-${i}`, title: `${String(i + 1).padStart(4, '0')}. Song ${i + 1} - Super Simple Songs`, stream: '/fixture.mp4', size_bytes: 12345678 })) } }));
    // Media bytes are outside this navigation test; keep native playback from fetching a fixture.
    await page.addInitScript(() => {
      Object.defineProperty(HTMLMediaElement.prototype, 'src', { get() { return this._testSrc || ''; }, set(value) { this._testSrc = value; } });
      Object.defineProperty(HTMLMediaElement.prototype, 'duration', { get() { return 120; } });
      HTMLMediaElement.prototype.load = function () { setTimeout(() => this.dispatchEvent(new Event('loadedmetadata')), 0); };
      HTMLMediaElement.prototype.play = function () { this.dispatchEvent(new Event('playing')); return Promise.resolve(); };
      HTMLMediaElement.prototype.pause = function () {};
    });
    await page.goto(base); await page.locator('#loginForm').waitFor({ state: 'visible' });
    assert.equal((await page.request.get(base + '/assets/companion-navigation.css')).status(), 200);
    await page.locator('#loginForm [name=password]').fill('local-test-pass'); await page.locator('#loginForm button').click(); await page.locator('#app').waitFor({ state: 'visible' });
    await page.locator('[data-view=companion]').click();
    await page.waitForFunction(() => document.querySelector('#videoSelect').options.length === 228 && document.querySelector('#storyCatalogue').children.length > 0);
    assert.equal(await page.locator('[data-companion-panel]:visible').count(), 1);
    assert.equal(await page.locator('.companion-entry:visible').count(), 4);
    assert.equal(await page.locator('.companion-entries').evaluate(node => getComputedStyle(node).display), 'grid');
    assert.equal(await page.locator('#handoff').isVisible(), false);
    assert.equal(await page.locator('#aiForm').isVisible(), false);
    await page.locator('[data-companion-page=play]').click();
    await page.locator('#activityAge').selectOption('3');
    const age = await page.locator('#activityAge').inputValue();
    await page.locator('#interactionCards button').first().click();
    await page.locator('#activityDetail .activity-safety').waitFor({ state: 'visible' });
    await page.locator('#companionBack').click(); assert.equal(await page.locator('#activityAge').inputValue(), age);
    await page.locator('#companionBack').click();
    await page.locator('[data-companion-page=stories]').click();
    await page.locator('#storySearch').fill('不存在的故事 xyz'); assert.match(await page.locator('#storyCatalogue').innerText(), /没有找到/);
    await page.locator('#storySearch').fill(''); await page.locator('#storyCatalogue button').first().click();
    await page.locator('#storyNext').click(); assert.match(await page.locator('#storyCount').innerText(), /^2 /);
    await page.locator('#companionBack').click(); await page.locator('#companionBack').click();
    await page.locator('#companionResumeButton').click(); assert.match(await page.locator('#storyCount').innerText(), /^2 /);
    await page.locator('[data-companion-panel=reading] [data-companion-page=manage]').click();
    assert(await page.locator('#storyAdd').isVisible()); assert(await page.locator('#storySelect').isVisible());
    await page.locator('#storyAdd').click(); await page.locator('#storyEditor').waitFor({ state: 'visible' });
    await page.locator('#storyForm [name=title]').fill('导航测试故事');
    await page.locator('#storyForm [name=zh]').fill('测试中文'); await page.locator('#storyForm [name=en]').fill('Test English.');
    await page.locator('#storySave').click(); await page.locator('#storyEditor').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#storySelect').selectedOptions[0].text.includes('导航测试故事'));
    await page.locator('#storyEdit').click(); await page.locator('#storyForm [name=title]').fill('编辑后的故事');
    await page.locator('#storySave').click(); await page.locator('#storyEditor').waitFor({ state: 'hidden' });
    await page.locator('#companionBack').click(); await page.locator('#companionBack').click();
    await page.locator('[data-companion-page=video]').click(); await page.locator('#videoSelect').selectOption('video-1');
    assert.equal(await page.locator('#videoPosition').innerText(), '2 / 227');
    await page.locator('#videoNext').click(); assert.equal(await page.locator('#videoSelect').inputValue(), 'video-2');
    await page.locator('#videoPrev').click(); assert.equal(await page.locator('#videoSelect').inputValue(), 'video-1');
    await page.locator('#videoAutoNext').uncheck(); await page.evaluate(() => document.querySelector('#videoPlayer').dispatchEvent(new Event('ended')));
    assert.equal(await page.locator('#videoSelect').inputValue(), 'video-1');
    await page.locator('#videoAutoNext').check(); await page.evaluate(() => document.querySelector('#videoPlayer').dispatchEvent(new Event('ended')));
    assert.equal(await page.locator('#videoSelect').inputValue(), 'video-2'); await page.locator('#videoPrev').click();
    await page.evaluate(() => { const video = document.querySelector('#videoPlayer'); video.currentTime = 42; video.dispatchEvent(new Event('pause')); });
    await page.locator('#companionBack').click(); assert.match(await page.locator('#companionResumeMeta').innerText(), /0:42/);
    await page.locator('[data-companion-page=favorites]').click(); await page.locator('#favoriteManage summary').click(); assert(await page.locator('#favoriteForm').isVisible());
    await page.goBack(); await page.locator('[data-companion-panel=home]').waitFor({ state: 'visible' });
    // Reload restores the local resume card without automatically starting any media.
    await page.reload(); await page.locator('#app').waitFor({ state: 'visible' }); await page.locator('[data-view=companion]').click();
    await page.locator('#companionResume').waitFor({ state: 'visible' }); assert.match(await page.locator('#companionResumeMeta').innerText(), /0:42/);
    await page.locator('#companionResumeButton').click();
    await page.waitForFunction(() => document.querySelector('#videoPlayer').currentTime === 42);
    await page.locator('#companionBack').click();
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `homepage must fit ${width}px`);
      await page.locator('[data-companion-page=video]').click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `player must fit ${width}px`);
      await page.locator('#companionBack').click();
      await page.locator('[data-companion-page=play]').click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `activities must fit ${width}px`);
      await page.locator('#interactionCards button').first().click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `activity detail must fit ${width}px`);
      await page.locator('#companionBack').click(); await page.locator('#companionBack').click();
      await page.locator('[data-companion-page=stories]').click(); await page.locator('#storyCatalogue button').first().click();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `reader must fit ${width}px`);
      await page.locator('#companionBack').click(); await page.locator('#companionBack').click();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.SCREENSHOT_DIR) {
      await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'companion-home.png'), fullPage: true });
      await page.locator('[data-companion-page=video]').click(); await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'companion-video.png'), fullPage: true });
    }
    await page.locator('[data-view=home]').click(); await page.locator('.home-ai summary').click(); assert(await page.locator('#aiForm').isVisible());
    assert.deepEqual(errors, [], 'no browser runtime errors'); console.log('Companion navigation browser checks passed');
  } finally {
    if (browser) await browser.close();
    server.kill(); await new Promise(r => { if (server.exitCode !== null) return r(); server.once('exit', r); setTimeout(r, 2000); });
    await rm(directory, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
