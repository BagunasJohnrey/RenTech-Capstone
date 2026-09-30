import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import routes from '../src/routes/index.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import {
  isSendableEmail,
  sendEmail,
  checkBrevoHealth,
} from '../src/services/brevo.service.js';
import { isBrevoTokenFormat } from '../src/services/auth.service.js';
import {
  verificationEmail,
  passwordResetEmail,
  bookingConfirmationEmail,
  pickupEmail,
  returnEmail,
  cancellationEmail,
  dueReminderEmail,
  overdueEmail,
} from '../src/templates/emailTemplates.js';

describe('brevo token format', () => {
  it('accepts 64-char hex tokens', () => {
    expect(isBrevoTokenFormat('a'.repeat(64))).toBe(true);
    expect(isBrevoTokenFormat('A1'.repeat(32))).toBe(true);
  });

  it('rejects legacy credential shapes', () => {
    expect(isBrevoTokenFormat('valid-hash')).toBe(false);
    expect(isBrevoTokenFormat('')).toBe(false);
    expect(isBrevoTokenFormat('short')).toBe(false);
  });
});

describe('brevo recipient guard', () => {
  it('accepts normal emails', () => {
    expect(isSendableEmail('customer@example.com')).toBe(true);
  });

  it('rejects blanks, invalid shapes, and walk-in synthetic addresses', () => {
    expect(isSendableEmail(null)).toBe(false);
    expect(isSendableEmail('')).toBe(false);
    expect(isSendableEmail('not-an-email')).toBe(false);
    expect(isSendableEmail('walkin_abc@rentech.invalid')).toBe(false);
  });
});

describe('brevo sendEmail (simulated — no BREVO_API_KEY in tests)', () => {
  it('simulates delivery without hitting the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const result = await sendEmail({
        to: 'customer@example.com',
        subject: 'Hi',
        html: '<p>Hi</p>',
      });
      expect(result.simulated).toBe(true);
      expect(result.delivered).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects invalid recipients before any send', async () => {
    await expect(
      sendEmail({ to: 'walkin_abc@rentech.invalid', subject: 'Hi', html: '<p>Hi</p>' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('brevo health probe', () => {
  it('reports simulated dev mode without a key', async () => {
    const health = await checkBrevoHealth();
    expect(health.configured).toBe(false);
    expect(health.simulated).toBe(true);
  });
});

describe('email templates (branded, fee-policy aware)', () => {
  const URL = 'http://localhost:5173/verify-email?token=abc';

  it('verification email carries the name + link + 24h notice', () => {
    const built = verificationEmail('Maria', URL);
    expect(built.subject).toContain('Verify');
    expect(built.html).toContain('Maria');
    expect(built.html).toContain(URL);
    expect(built.html).toContain('24 hours');
    expect(built.html).toContain('Balayan, Batangas');
    expect(built.text).toContain(URL);
  });

  it('password-reset email carries the link + 1h warning + ignore notice', () => {
    const built = passwordResetEmail('Maria', URL);
    expect(built.subject).toContain('Reset');
    expect(built.html).toContain(URL);
    expect(built.html).toContain('1 hour');
    expect(built.text).toContain(URL);
  });

  it('booking confirmation lists item, dates, and amounts + booking code', () => {
    const built = bookingConfirmationEmail({
      customerName: 'Maria',
      itemName: 'Red Gown',
      pickupDate: '01/10/2026',
      dueDate: '01/13/2026',
      rentalFee: 1500,
      downpayment: 750,
      balance: 750,
      bookingCode: 'RT-ABC12345',
    });
    expect(built.subject).toContain('Red Gown');
    expect(built.html).toContain('RT-ABC12345');
    expect(built.html).toContain('1,500');
    expect(built.text).toContain('RT-ABC12345');
  });

  it('pickup email names the item + due date', () => {
    const built = pickupEmail('Maria', 'Red Gown', '01/13/2026');
    expect(built.html).toContain('Red Gown');
    expect(built.html).toContain('01/13/2026');
  });

  it('return email thanks the customer and itemizes extra charges', () => {
    const plain = returnEmail('Maria', 'Red Gown');
    expect(plain.subject).toContain('Red Gown');
    expect(plain.html).toContain('Thank you');

    const charged = returnEmail('Maria', 'Red Gown', { latePenalty: 500, damageFee: 1000 });
    expect(charged.html).toContain('500');
    expect(charged.html).toContain('1,000');
  });

  it('cancellation email names the item', () => {
    const built = cancellationEmail('Maria', 'Red Gown');
    expect(built.subject).toContain('Red Gown');
    expect(built.html).toContain('cancelled');
  });

  it('due-reminder email names item + due date', () => {
    const built = dueReminderEmail('Maria', 'Red Gown', '01/13/2026');
    expect(built.subject).toContain('Red Gown');
    expect(built.html).toContain('01/13/2026');
  });

  it('overdue email carries NO peso amounts (fee-free policy)', () => {
    const built = overdueEmail('Maria', 'Red Gown', 3);
    expect(built.html).toContain('overdue');
    expect(built.html).not.toContain('₱');
    expect(built.text).not.toContain('₱');
  });
});

describe('GET /api/settings/integrations-status (brevo row)', () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api', routes);
  app.use(errorHandler);

  it('exposes brevo alongside the other providers (admin, MFA-verified)', async () => {
    const res = await request(app)
      .get('/api/settings/integrations-status')
      .set('Authorization', 'Bearer admin-token');

    // Admin MFA gate: the setup.ts admin token carries aal:2 in app_metadata,
    // so requireMfaAdmin passes without the rt_mfa_verified marker.
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('brevo');
    expect(res.body.brevo.configured).toBe(false);
    expect(res.body.brevo.simulated).toBe(true);
    expect(res.body).toHaveProperty('semaphore');
    expect(res.body).toHaveProperty('paymongo');
  });
});
