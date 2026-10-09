# NOTICE: `payment_intent_id` drift on `transactions` (do NOT `db push` blindly)

**Status:** known, harmless if left alone, fixable without data loss.
**Verified live:** 2026-10-09 (290 transactions).

---

## What happened

The Maya QRPh rename (`payment_intent_id` → `gateway_payment_id` + `gateway`,
`Payment.paymongo_pi_id` → `gateway_ref` + `gateway`) was applied to the live
database with raw SQL (`prisma db execute`), **not** through a migration or
`db push`. The old `payment_intent_id` column was left behind on
`transactions`, so the live table now carries **both** columns:

| Column | In `schema.prisma`? | Live rows set |
|---|---|---|
| `gateway_payment_id` (+ `gateway`) | ✅ yes (what the code reads/writes) | 122 |
| `payment_intent_id` | ❌ no (invisible to Prisma) | 17 |

## Why this blocks `db push`

Prisma compares the schema file against the live table, sees an unmapped
column, and plans to **DROP `payment_intent_id` — which still holds 17
non-null values**. It refuses without `--accept-data-loss`, and that flag
must never be used here (it would silently destroy payment references).

This already bit once: on 2026-10-09 a routine `db push` (for the new
`profiles.avatar_path` column) was refused for exactly this reason. The
avatar column was applied instead with targeted SQL
(`ALTER TABLE … ADD COLUMN IF NOT EXISTS`), leaving this drift untouched.

## Impact if left alone

**None on runtime.** Prisma only reads/writes mapped columns, and every live
code path (PayMongo webhook, Maya webhook, polling self-heal, ledger) uses
`gateway_payment_id`. The old column is dead weight — but it *does* block
every future `db push` until reconciled.

## What's actually in the old column (live audit, 2026-10-09)

- All 17 values are `sim_…` (simulated PayMongo intents — dev/test data, **no
  real money at stake**).
- **15 of 17** already have the identical value copied into
  `gateway_payment_id` (the rename backfill worked for those).
- **2 rows** have the ref *only* in the old column (`gateway_payment_id` is
  NULL) — both `status = 'Reserved'`:
  - `228db078-…` (`sim_266094960ae03d4b`)
  - `3408130f-…` (`sim_3c03f1d5fc0a1614`)

Dropping the column today would orphan those 2 rows' payment refs
(no webhook could ever bind to them again).

## Safe reconciliation recipe (no data loss)

Run in order, verifying each step. Prefer a quiet period (no live bookings
mid-flight). Take the admin one-click JSON backup first (covers table data).

```sql
-- 1. Backfill the 2 orphan refs into the new column.
UPDATE transactions
SET gateway_payment_id = payment_intent_id
WHERE payment_intent_id IS NOT NULL
  AND gateway_payment_id IS NULL;
-- Expect: 2 rows updated.

-- 2. Verify nothing is left behind (expect 0).
SELECT COUNT(*) FROM transactions
WHERE payment_intent_id IS NOT NULL
  AND gateway_payment_id IS NULL;

-- 3. Spot-check the 2 backfilled rows, then drop the legacy column.
ALTER TABLE transactions DROP COLUMN payment_intent_id;

-- 4. Confirm the drift is gone.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'transactions'
  AND column_name IN ('payment_intent_id', 'gateway_payment_id', 'gateway');
-- Expect: gateway, gateway_payment_id (no payment_intent_id).
```

Optional, same window: the 17 legacy rows have `gateway = NULL` (pre-gateway
era). Since every one of their refs is a `sim_…` PayMongo-style id, they can
be labeled without changing behavior:

```sql
UPDATE transactions SET gateway = 'paymongo'
WHERE gateway IS NULL AND gateway_payment_id LIKE 'sim\_%' ESCAPE '\';
```

After step 4, `npx prisma db push --skip-generate` stops warning about this
table. (If it warns about anything else, stop — that's a *different* drift,
do not `--accept-data-loss`.)

## Rules going forward

1. **Never run `prisma db push --accept-data-loss` against the live DB.**
   A data-loss warning is the tool telling you about drift like this one —
   resolve the drift with targeted SQL first.
2. **Renames go through a recorded migration or a documented SQL file.**
   `db execute --file` is fine for additive/backfill SQL, but the file must be
   kept (the Maya rename left no artifact — that is how this column survived
   unnoticed).
3. After any manual DDL, re-run the read-only drift check that works on the
   pooler:
   `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`
   (exit 0 = clean; a complaint limited to *this* table before the fix above
   is expected).
