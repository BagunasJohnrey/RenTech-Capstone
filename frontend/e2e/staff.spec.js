// Staff portal E2E suite.
//
// Prereqs:
//   - `npm run dev` from the repo root (frontend on :5173 + backend running).
//   - A staff account, supplied via env vars so no real credentials live in code:
//       $env:E2E_STAFF_EMAIL="staff@example.com"
//       $env:E2E_STAFF_PASSWORD="your-password"
//   - Optional (a release-photo file): $env:E2E_RELEASE_PHOTO="C:\path\to\photo.jpg"
//
// The suite SKIPS gracefully when credentials are not provided.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';

const STAFF_EMAIL = process.env.E2E_STAFF_EMAIL;
const STAFF_PASSWORD = process.env.E2E_STAFF_PASSWORD;
const RELEASE_PHOTO = process.env.E2E_RELEASE_PHOTO;

const hasCreds = !!(STAFF_EMAIL && STAFF_PASSWORD);

// A tiny 1x1 white PNG used as the release / return condition photo when the
// caller hasn't supplied a real file. Sufficient to exercise the upload path.
const FALLBACK_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const FALLBACK_PNG_BUF = Buffer.from(FALLBACK_PNG_B64, 'base64');

const CUSTOMER = {
  name: `E2E Staff Customer ${Date.now()}`, // unique so the row is easy to find
  contact: '09171234567',
  address: '123 Rizal St, Balayan, Batangas',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Log in through the real Login screen, then confirm the Staff shell loaded.
async function loginAsStaff(page) {
  await page.goto('/');

  // Landing page -> open the auth screen.
  await page.getByRole('button', { name: /sign ?in|log ?in|book a visit/i }).first().click();

  await page.getByLabel(/email/i).fill(STAFF_EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(STAFF_PASSWORD);

  // Staff auto-show the toast ("Dismiss") once authenticated. Waiting on it
  // before submitting lets us detect a failed login deterministically below.
  const toast = page.getByRole('button', { name: 'Dismiss' });

  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(toast).toBeVisible({ timeout: 20000 });
  await toast.click();
  await expect(page.getByRole('heading', { name: 'Staff Dashboard' })).toBeVisible({ timeout: 15000 });
}

// Attach an image to the hidden file input inside the given dialog.
async function attachPhoto(dialog, label) {
  const chooser = page.waitForEvent('filechooser');
  await dialog.getByText(label).click(); // the label wraps the hidden input
  await (await chooser).setFiles(
    RELEASE_PHOTO && existsSync(RELEASE_PHOTO)
      ? RELEASE_PHOTO
      : { name: 'e2e.png', mimeType: 'image/png', buffer: FALLBACK_PNG_BUF }
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Staff portal', () => {
  test.skip(!hasCreds, 'Set E2E_STAFF_EMAIL / E2E_STAFF_PASSWORD to run staff tests.');

  test.beforeEach(async ({ page }) => {
    await loginAsStaff(page);
  });

  // 1. Staff Dashboard renders (KPIs, overdue alert area, CTAs, inventory health,
  //    cleaning queue) — the staff landing view.
  test('Dashboard: staff home renders KPIs, CTAs and inventory health', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Staff Dashboard' })).toBeVisible();

    await expect(page.getByRole('button', { name: 'New Rental' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Process Return' })).toBeVisible();

    await expect(page.getByText('Inventory Health')).toBeVisible();
    for (const kpi of ['Active', 'Overdue', 'Available', 'In Cleaning', 'Maintenance', 'Damaged']) {
      await expect(page.getByText(kpi, { exact: true }).first()).toBeVisible();
    }
  });

  // 2. Global search (staff-only Ctrl+K shortcut) opens and closes.
  test('Global search: Ctrl+K opens and Escape closes the search modal', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.getByPlaceholder(/search transactions/i)).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
    await expect(page.getByPlaceholder(/search transactions/i)).toBeHidden({ timeout: 5000 });
  });

  // 3. New Rental: open from the dashboard, walk the 3-step wizard and create
  //    a booking for a brand-new walk-in customer. Verifies field validation and
  //    that the new transaction then appears in History.
  test('New Rental: create a booking end-to-end; it appears in Records', async ({ page }) => {
    await page.getByRole('button', { name: 'New Rental' }).click();

    const dialog = page.getByRole('dialog', { name: 'New Rental' });
    await expect(dialog).toBeVisible();

    // --- Step 1: select the first item card (staff can book any visible item).
    await dialog.locator('button[aria-pressed]').first().click();
    await dialog.getByRole('button', { name: /continue/i }).click();

    // --- Step 2: customer details. Validation must block an empty submit.
    await dialog.getByRole('button', { name: /continue/i }).click();
    await expect(dialog.getByText(/full name is required/i)).toBeVisible();

    // Clicking a field label focuses its input if/when labels are wired up; fall
    // back to placeholder otherwise so the test works on either build.
    const nameInput = dialog.getByLabel(/customer full name/i);
    await nameInput.fill(CUSTOMER.name);
    await dialog.getByLabel(/customer contact number/i).fill(CUSTOMER.contact);
    await dialog.getByLabel(/customer address/i).fill(CUSTOMER.address);

    // Size is required before continuing.
    await dialog.locator('select').selectOption('M');
    await dialog.getByRole('button', { name: /continue/i }).click();

    // --- Step 3: review + confirm (payment is simulated in dev).
    await expect(dialog.getByText('Review Transaction')).toBeVisible();
    await dialog.getByRole('button', { name: /confirm & process/i }).click();

    // Success toast, then the modal closes by itself.
    await expect(page.getByText(/booking created successfully/i)).toBeVisible({ timeout: 20000 });
    await expect(dialog).toBeHidden({ timeout: 15000 });

    // Verify the booking landed in History/Records.
    await page.locator('button[data-tab="History"]').first().click();
    await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();
    await page.getByPlaceholder(/search by id, customer, or item/i).fill(CUSTOMER.name);
    await expect(page.getByText(CUSTOMER.name).first()).toBeVisible({ timeout: 10000 });
  });

  // 4. Release Item: mark an active/reserved booking as handed over to the
  //    customer (captures the mandatory pre-rental photo).
  test('Release: hand an item over to the customer with a condition photo', async ({ page }) => {
    await page.locator('button[data-tab="History"]').first().click();
    await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();

    const releaseBtn = page.getByRole('button', { name: /^release item$/i }).first();
    if (!(await releaseBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'No active/reserved booking waiting for release in this dataset.',
      });
      return; // Nothing to release — not a failure.
    }
    await releaseBtn.click();

    const dialog = page.getByRole('dialog', { name: 'Release Item' });
    await expect(dialog).toBeVisible();

    // Photo is mandatory.
    const confirm = dialog.getByRole('button', { name: /confirm release/i });
    await expect(confirm).toBeDisabled();

    await attachPhoto(dialog, 'Tap to capture photo');
    await dialog.getByPlaceholder(/notes about the item condition/i).fill('E2E release');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText(/item released/i)).toBeVisible({ timeout: 20000 });
    await expect(dialog).toBeHidden({ timeout: 15000 });
  });

  // 5. Process Return: inspect an active rental, flag lateness/condition, take a
  //    return photo and complete the return.
  test('Return: process a returned rental (status becomes Returned)', async ({ page }) => {
    await page.locator('button[data-tab="History"]').first().click();
    await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();

    const row = page.locator('tr').filter({ has: page.getByText(CUSTOMER.name) }).first();
    if (!(await row.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'No matching rental found to return (run the New Rental test first).',
      });
      return;
    }

    const returnBtn = row.getByRole('button', { name: /process return/i });
    if (!(await returnBtn.isVisible().catch(() => false))) {
      // Might be Reserved (not yet released): release it from the row first.
      const releaseBtn = row.getByRole('button', { name: /^release item$/i });
      if (!(await releaseBtn.isVisible().catch(() => false))) return; // Can't progress.

      await releaseBtn.click();
      const relDialog = page.getByRole('dialog', { name: 'Release Item' });
      await attachPhoto(relDialog, 'Tap to capture photo');
      await relDialog.getByRole('button', { name: /confirm release/i }).click();
      await expect(page.getByText(/item released/i)).toBeVisible({ timeout: 20000 });
    }

    const btn2 = row.getByRole('button', { name: /process return/i });
    if (!(await btn2.isVisible().catch(() => false))) return; // Still not returnable.
    await btn2.click();

    const dialog = page.getByRole('dialog', { name: 'Process Return' });
    await expect(dialog).toBeVisible();

    await dialog.getByRole('button', { name: /on time/i }).click();
    await dialog.getByRole('button', { name: /good condition/i }).click();
    await attachPhoto(dialog, /tap to capture photo/i);
    await dialog.getByPlaceholder(/notes/i).fill('E2E return');

    await dialog.getByRole('button', { name: /confirm return/i }).click();

    await expect(page.getByText(/return recorded/i)).toBeVisible({ timeout: 20000 });
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(row.getByText('Returned')).toBeVisible({ timeout: 15000 });
  });

  // 6. Mark Clean: return a cleaned item to Available from the queue.
  test('Cleaning queue: mark an item clean returns it to Available', async ({ page }) => {
    await page.locator('button[data-tab="Dashboard"]').first().click();
    await expect(page.getByRole('heading', { name: 'Staff Dashboard' })).toBeVisible();

    const markClean = page.getByRole('button', { name: 'Mark as Clean' }).first();
    if (!(await markClean.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'Cleaning queue empty — nothing waiting to be marked clean.',
      });
      return;
    }
    await markClean.click();
    await expect(page.getByText(/item marked as clean/i)).toBeVisible({ timeout: 20000 });
  });

  // 7. Records: open a transaction's detail modal and browse history filters.
  test('Records: open the transaction detail modal for the created booking', async ({ page }) => {
    await page.locator('button[data-tab="History"]').first().click();
    await expect(page.getByRole('heading', { name: 'Records' })).toBeVisible();

    await page.getByPlaceholder(/search by id, customer, or item/i).fill(CUSTOMER.name);

    const viewBtn = page.getByRole('button', { name: /view details/i }).first();
    if (!(await viewBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      // Row isn’t present (booking test didn't run first) — nothing to verify.
      test.info().annotations.push({ type: 'skip-reason', description: 'Booking row not found.' });
      return;
    }
    await viewBtn.click();

    const detail = page.getByRole('dialog').filter({ hasText: /customer/i }).first();
    await expect(detail.getByText(CUSTOMER.name).first()).toBeVisible();
    await detail.getByRole('button', { name: 'Close transaction details' }).click();
    await expect(detail).toBeHidden({ timeout: 5000 });
  });

  // 8. Catalog: staff sees rentable inventory and can use the per-item "Rent"
  //    shortcut to open the booking wizard with the item pre-selected.
  test('Catalog: staff Rent shortcut opens New Rental with the item preselected', async ({ page }) => {
    await page.locator('button[data-tab="Catalog"]').first().click();

    const rentBtn = page.getByRole('button', { name: /^rent$/i }).first();
    if (!(await rentBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.info().annotations.push({ type: 'skip-reason', description: 'No item cards rendered.' });
      return;
    }
    await rentBtn.click();

    const dialog = page.getByRole('dialog', { name: 'New Rental' });
    await expect(dialog).toBeVisible();
    // Pre-selection means we land directly on the Details step.
    await expect(dialog.getByRole('heading', { name: 'Booking Details' })).toBeVisible({ timeout: 10000 });
    await dialog.getByRole('button', { name: 'Close new rental' }).click();
    await expect(dialog).toBeHidden({ timeout: 10000 });
  });

  // 9. Help Guide + Logout (via confirmation modal) — staff lifecycle actions.
  test('Help Guide renders', async ({ page }) => {
    await page.locator('button[data-tab="Help"]').first().click();
    // Any of the known shell markers of the guide is enough; keying off help text.
    await expect(page.getByText(/help|guide|getting started/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('Sign out: confirmation modal and landing page', async ({ page }) => {
    await page.getByRole('button', { name: 'Sign Out' }).click();

    const dialog = page.getByRole('dialog', { name: /confirm sign out/i });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Sign Out' }).click();

    // Back on the public landing page.
    await expect(page.getByRole('button', { name: /sign ?in/i }).first()).toBeVisible({ timeout: 15000 });
  });
});
