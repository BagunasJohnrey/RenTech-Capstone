# Plan: Make Storage Credential Faults Visible at Boot

Status: **proposed** — three low-risk backend changes, no schema change, no migration, no deploy-order risk.

## Why this document exists

On **2026-10-01** every condition photo (`rental/…`) in production returned `404 File not found` while all catalog photos rendered fine. The objects were present and byte-identical in `rentech-items`, and the Supabase project, bucket name, and dashboard credential were all provably correct. The serving process was simply holding a stale credential from an earlier deploy. A redeploy fixed it.

The real defect was not the stale credential — it was that **the boot log could not detect it**. Two independent lines that exist specifically to catch this class of fault both reported success:

```
[supabase] service key role: service_role (ref pphziospfughcyrstigp)   ← unverified claim
[storage] signed URL test skipped — no sample file in bucket             ← never ran
```

The failure then presented to the client as a *missing file*, sending the investigation toward deleted data and a botched project restore rather than toward a credential. Restart appeared to "fix" it, because env is read once at import and a redeploy re-reads it — reinforcing the wrong mental model instead of correcting it.

This plan closes that gap. Target: **a wrong credential must fail loudly at boot, and a genuinely missing object must be distinguishable from a permission failure.**

## Background: why env drift happens at all

`env.ts:2` (`dotenv.config()`), `config/supabase.ts:3` (`supabaseAdmin`), and `storage.service.ts:17-18` (`BUCKET_NAME`, `CATALOG_BUCKET`) all evaluate **once at module import**. `BUCKET_NAME` is a module-level `const`. Nothing re-reads them; there are zero runtime assignments to `process.env` anywhere in the backend.

Consequence: on Render, a dashboard env edit is inert until a restart, and a rolling deploy can leave an older instance serving traffic with an older credential. This is the same trap already recorded in AGENTS.md for `STORAGE_BUCKET` ("`STORAGE_BUCKET` changed Sept 24, old process kept signing condition photos against the previous bucket → every `rental/…` signed URL 404'd until restart"). This plan generalises the tripwire from *one variable* to *the class of fault*.

## Evidence that pins the diagnosis

Measured against project `pphziospfughcyrstigp`, private bucket `rentech-items`:

| Credential | `createSignedUrl` result |
|---|---|
| real `service_role` | **OK** |
| anon key | `status=400 statusCode=404 "Object not found"` |
| forged `role:service_role`, bad signature | `403 signature verification failed` |
| empty key | `403 Invalid Compact JWS` |

The production logs showed `statusCode: '404'` + `"Object not found"` — byte-identical to the **anon** row. A rotated or malformed `service_role` key surfaces as `403`, which `storageErrorStatus()` already maps to `500`, not `404`.

Also ruled out, so the next person need not re-test them:

- **Missing objects** — `rental/63d1c272-…/release-1790778529221.webp` exists, 165986 b, uploaded `2026-09-30T14:28:51Z`.
- **Instance split / stale drain** — 20 consecutive requests with `connection: close` (defeating keep-alive) returned `20x 404`, no mix.
- **Uptime-dependent drift** — no runtime `process.env` mutation; the only `dotenv.config()` is at import time; the daily `purgeOldData` touches only `Notification`/`SentSms`/`AuditLog`/`EmailToken` rows (`retention.service.ts:33-40`); `removeObject` fires only on item delete.
- **A `render.yaml` override** — no such file exists in this repo.

## Change 1 — verify the key's signature at boot (highest value, smallest diff)

**File:** `backend/src/config/supabase.ts` (`supabaseKeyRole()`, lines 20-29)

Today the function `JSON.parse`s the JWT payload and prints `payload.role`. It performs **no signature verification**, so any string with a decodable payload claiming `role: service_role` prints `service_role`. That is precisely why the broken instance looked healthy.

Two acceptable implementations — pick one:

- **(a) Preferred, no new dependency:** compute a short SHA-256 fingerprint of the configured key and log it alongside the decoded claims. A fingerprint is stable per key, reveals *which* credential a process is holding without logging any secret material, and makes a stale instance trivially identifiable across deploys.
- **(b) Stronger:** verify the HS256 signature against `env.SUPABASE_JWT_SECRET` and report `verified` / `signature-invalid` explicitly.

Either way, treat a non-`service_role` role or a failed verification as a **loud warning** (`console.warn`) that names the remediation, not a neutral log line. The comment at lines 15-19 already documents the intent; the code does not deliver it.

Verify: boot the backend with an anon key in `SUPABASE_SERVICE_ROLE_KEY` → the warning names `anon` and the mismatch. Boot with the real key → no warning, fingerprint matches the previous run.

## Change 2 — make the startup signing test actually run

**File:** `backend/src/index.ts` (lines 129-159)

The self-test lists the bucket root, descends **exactly one level**, and requires a file. Since the two-bucket split moved all catalog photos to `rentech-catalog`, the root of `rentech-items` now contains only two *folders* — `rental/` and `thumbs/`. Every entry has `id == null`, so `sample` stays `null` and the test prints `skipped`. It has been permanently incapable of failing.

It cannot detect the fault **and** cannot confirm health. Either fix it or delete it; keeping a green light that means nothing is the worst option.

If fixed, it must recurse to find a real object under `rental/` and then actually call `createSignedUrl` on it — asserting on the *result*, not just finding a name. A skip must be reported as `SKIPPED (no probe object)` rather than as a pass.

Consider deriving the probe path from configuration rather than hardcoding a UUID, so the test survives future data changes.

Verify: with a bad credential the boot log shows the failure. With a good credential it shows `OK`. If no probe object can be found, it says so explicitly.

## Change 3 — separate "denied" from "absent" in `storageErrorStatus()`

**File:** `backend/src/services/storage.service.ts` (`storageErrorStatus()`, lines 270-290)

Today everything that is not 429/5xx/network/`bucket not found` collapses to **404**, and `getDownloadUrl()` surfaces that as `File not found`. Two very different faults are therefore indistinguishable to the client:

- the object genuinely does not exist (a data problem), and
- RLS or a bad credential denied the read (a configuration problem).

This is what misdirected the investigation. Introduce a distinct classification for permission failures and map it to a status that reads as *configuration*, not *missing data* — Supabase's own wording for this case is `Object not found` with an underlying `403`/RLS denial, so key off the status/RLS signals rather than the message text alone.

Existing tests to extend (`backend/tests/storage.test.ts`, the `storageErrorStatus` describe block at lines 160-183):
- `Object not found` + `status: 400` + `statusCode: '404'` → still `404` (**genuine miss** — do not regress this)
- an RLS/permission-denied shape → the new distinct status
- keep all existing `503` and `500` cases green

Note for test authors: `tests/setup.ts:19` sets `SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'`, which is **not a JWT**. Change 1 must degrade gracefully to a warning on an undecodable key rather than throwing at import — otherwise the whole suite breaks.

## Order of work

1. **Change 3** first — pure function, no I/O, tests already exist, zero deployment risk.
2. **Change 1** second — small, self-contained, must not break `tests/setup.ts`.
3. **Change 2** last — touches boot ordering; easiest to reason about once the other two can report the truth.

Each is independently shippable. Do not batch them into one deploy: this whole incident was caused by an unverifiable environment, and batching would make the next one just as hard to read.

## Verification

```powershell
# Backend typecheck + full suite
cd backend; npx tsc --noEmit; npm test

# Frontend must still build (no frontend change expected)
cd ..\frontend; npm run build
```

Manual boot check — deliberately break the credential, then confirm the log is loud:

```powershell
$env:SUPABASE_SERVICE_ROLE_KEY = $env:SUPABASE_ANON_KEY   # force the anon path
npm run dev --prefix backend
```

Expect a warning naming the role mismatch and a **failing** (not skipped) signing self-test.

## Out of scope

- **Re-uploading the one genuinely orphaned photo.** `rental/d935b4b8-76c3-4f0d-8c35-e0aa54d93456/return-1788844400873.webp` is a legacy `.jpg` that exists only in the pre-split `rentech-images` bucket. The migration moved 110 catalog objects; condition shots landed in both buckets. This is a data gap, not a code defect — re-upload the photo or clear that transaction's `returnPhoto`. Worth a one-off audit for other `rental/` paths present in `rentech-images` but absent from `rentech-items`.
- **The stale-instance root cause.** Render's rolling deploy can serve an older instance after a dashboard env change. That is host behaviour. These changes make it *detectable within seconds of boot* rather than eliminating it.
- **`STORAGE_BUCKET` / `STORAGE_CATALOG_BUCKET` drift.** Already covered by the AGENTS.md dev warning, but only in dev (`index.ts:96` gates it on `NODE_ENV !== 'production'`). Consider whether a production variant is warranted once Changes 1-2 land.

## Follow-ups worth considering separately

- `docs/BACKUPS.md` (Troubleshooting) tells operators to check that the boot log "must say `service_role`". After Change 1, update that guidance to reference the verified fingerprint and the self-test result, since the bare role string will no longer be sufficient evidence.
- `frontend/src/utils/imageCache.js` caches signed URLs in `sessionStorage` (`rt_img_cache_v1`, 59-min TTL) — **including failures**. A 404 sticks in the tab and mimics a server fault during local testing. Consider not caching negative results, or surfacing a "retry" affordance.