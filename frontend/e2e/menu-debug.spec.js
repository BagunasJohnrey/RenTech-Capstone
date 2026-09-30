import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['Pixel 5'], hasTouch: true });

test('mobile row menu items are tappable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { const t = m.text(); if (t.includes('menu-debug') || ['error', 'warning'].includes(m.type())) console.log('[page.' + m.type() + ']', t.slice(0, 200)); });
  await page.goto('/?demo=staff');
  // Dismiss the first-visit onboarding tutorial if it shows.
  await page.getByRole('button', { name: /close tutorial/i }).click({ timeout: 5000 }).catch(() => {});
  // Open the transactions history tab (bottom nav) and wait for the route.
  await page.getByRole('button', { name: /logs/i }).first().click({ timeout: 15000 });
  await page.waitForURL(/log/i, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: '../menu-tab.png' });
  const navLabels = await page.getByRole('button').allInnerTexts();
  console.log('BUTTONS:', JSON.stringify(navLabels.slice(0, 30)));
  // Mobile cards: tap the first row's overflow button.
  const more = page.getByRole('button', { name: 'More actions' }).first();
  await more.scrollIntoViewIfNeeded();
  await more.tap({ timeout: 10000 });
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible({ timeout: 5000 });
  await page.screenshot({ path: '../menu-open.png' });
  const info = await page.evaluate(() => {
    const m = document.querySelector('[role="menu"]');
    const btns = [...document.querySelectorAll('button')].filter((b) => b.getAttribute('aria-label') === 'More actions');
    const mr = m ? m.getBoundingClientRect().toJSON() : null;
    return {
      menus: document.querySelectorAll('[role="menu"]').length,
      menuRect: mr,
      menuStyle: m ? m.getAttribute('style') : null,
      btns: btns.map((b) => ({ visible: b.offsetParent !== null, rect: b.getBoundingClientRect().toJSON() })),
      inner: { w: window.innerWidth, h: window.innerHeight },
    };
  });
  console.log('MENU-INFO:', JSON.stringify(info));
  // Tap "Call customer" — menu must close (proves the tap registered).
  // NOTE: .tap() (touch pipeline) vs .click() (mouse pipeline) compared —
  // the ⋯ button opened via tap, so touch-click synthesis works in general.
  const callItem = page.getByRole('menuitem', { name: 'Call customer' });
  await callItem.tap({ timeout: 5000 }).catch(async () => {
    await page.screenshot({ path: '../menu-stuck.png' });
    throw new Error('TAP ON CALL CUSTOMER FAILED — menu state captured in menu-stuck.png');
  });
  const hit = await callItem.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    const chain = [];
    let n = top;
    while (n && chain.length < 6) {
      chain.push(n.tagName + (n.className && typeof n.className === 'string' ? '.' + n.className.split(' ').slice(0, 3).join('.') : ''));
      n = n.parentElement;
    }
    return { x: Math.round(x), y: Math.round(y), hitChain: chain };
  });
  console.log('HIT-TEST:', JSON.stringify(hit));
  const stillOpen = await menu.isVisible().catch(() => false);
  console.log('MENU STILL OPEN AFTER TOUCH-TAP:', stillOpen);
  if (stillOpen) {
    console.log('Retrying with raw CDP mouse click at item center...');
    const box = await callItem.boundingBox();
    console.log('ITEM BOX:', JSON.stringify(box));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(500);
    console.log('MENU OPEN AFTER MOUSE CLICK:', await menu.isVisible().catch(() => false));
  }
  await expect(menu).toBeHidden({ timeout: 5000 });
  expect(errors).toEqual([]);
});
