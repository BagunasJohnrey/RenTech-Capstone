-- Shopee-style vouchers: percent cap ("up to PHP X") + "My Vouchers" wallet.
-- Additive only; safe to re-run.
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS max_discount DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS promo_claims (
  id TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  promo_code_id TEXT NOT NULL,
  claimed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT promo_claims_pkey PRIMARY KEY (id),
  CONSTRAINT promo_claims_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT promo_claims_promo_code_id_fkey FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS promo_claims_profile_id_promo_code_id_key ON promo_claims(profile_id, promo_code_id);
CREATE INDEX IF NOT EXISTS promo_claims_profile_id_idx ON promo_claims(profile_id);
