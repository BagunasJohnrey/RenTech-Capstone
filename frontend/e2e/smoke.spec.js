import { test, expect } from '@playwright/test';

// Smoke tests across the three roles. Role-specific flows are skipped unless
// credentials are supplied via env vars:
//   E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD
//   E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD
//   E2E_CUSTOMER_EMAIL / E2E_CUSTOMER_PASSWORD
const roles = ['Admin', 'Staff', 'Customer'];
const credsFor = (role) => ({
  email: process.env[`E2E_${role.toUpperCase()}_EMAIL`],
  password: process.env[`E2E_${role.toUpperCase()}_PASSWORD`],
});

test.describe('RenTech smoke', () => {
  test('landing page renders and opens the login screen', async ({ page }) => {
    await page.goto('/');
    const loginBtn = page.getByRole('button', { name: /sign ?in|log ?in/i }).first();
    await expect(loginBtn).toBeVisible();
    await loginBtn.click();
    // Sign-in is a real route (deep-linkable, works in new tabs).
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByText(/email/i)).toBeVisible();
    await expect(page.getByText('Password', { exact: true })).toBeVisible();
  });

  for (const role of roles) {
    test(`role: ${role} can authenticate and reach its portal shell`, async ({ page }) => {
      const { email, password } = credsFor(role);
      test.skip(!email || !password, `No credentials provided for ${role}`);

      await page.goto('/');
      await page.getByRole('button', { name: /log ?in/i }).first().click();
      await page.getByLabel(/email/i).fill(email);
      await page.getByLabel(/password/i).fill(password);
      await page.getByRole('button', { name: /sign in|log in/i }).click();

      // Authenticated shell: the role portal header is shown.
      await expect(page.getByText(/portal/i)).toBeVisible({ timeout: 15000 });
    });
  }
});
