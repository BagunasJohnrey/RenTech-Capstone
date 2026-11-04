-- Configurable reminder schedule + manual-call cutoff (client feedback §3.2–3.4).
-- Additive only; safe to re-run.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS overdue_sms_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS overdue_sms_last_at TIMESTAMP(3);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS overdue_email_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS overdue_email_last_at TIMESTAMP(3);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS manual_call_prompted_at TIMESTAMP(3);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS manual_called_at TIMESTAMP(3);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS manual_called_by_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS manual_call_note TEXT;

-- Backfill counts from the old once-guards so open overdue rentals don't
-- get a burst of "first" notices after deploy. last_at = now(): the next
-- repeat waits one full interval.
UPDATE transactions
   SET overdue_sms_count = (CASE WHEN overdue_sms_sent THEN 1 ELSE 0 END) + (CASE WHEN overdue_escalation_sent THEN 1 ELSE 0 END),
       overdue_sms_last_at = now()
 WHERE overdue_sms_count = 0 AND (overdue_sms_sent OR overdue_escalation_sent);
UPDATE transactions
   SET overdue_email_count = (CASE WHEN overdue_email_sent THEN 1 ELSE 0 END) + (CASE WHEN overdue_escalation_email_sent THEN 1 ELSE 0 END),
       overdue_email_last_at = now()
 WHERE overdue_email_count = 0 AND (overdue_email_sent OR overdue_escalation_email_sent);
