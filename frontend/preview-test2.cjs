const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const log = (...m) => console.log(...m);
  await page.addInitScript(() => { localStorage.setItem('onboardingDone', '1'); localStorage.setItem('onboardingDone_Customer', '1'); });
  try {
    await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /sign ?in|log ?in/i }).first().click();
    await page.getByRole('textbox', { name: /email/i }).fill('staff1@gmail.com');
    await page.getByRole('textbox', { name: 'Password' }).fill('12345678');
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForTimeout(4000);
    log('1) after login:', page.url());
    await page.goto('http://localhost:4173/staff/tasks', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /sign out/i }).first().click();
    await page.waitForTimeout(1000);
    log('2) modal:', await page.getByText('Confirm Sign Out').isVisible().catch(() => false));
    await page.getByRole('button', { name: /^Sign Out$/ }).last().click();
    await page.waitForTimeout(3000);
    log('3) after sign out:', page.url(), '| landing:', await page.getByText('Rent the outfit,').isVisible().catch(() => false), '| 404:', await page.getByText(/Page not found/i).isVisible().catch(() => false));
  } catch (err) { log('ERR:', err.message); }
  finally { await browser.close(); }
})();
