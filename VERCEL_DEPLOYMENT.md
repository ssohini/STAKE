# Vercel + Upstash Deployment Guide — STAKE

STAKE is designed to deploy directly to **Vercel** using **Upstash Redis** for persistent contract state and **PayPal Sandbox** (`https://api-m.sandbox.paypal.com`) for authorization holds.

> **Important:** Remain on PayPal Sandbox (`https://api-m.sandbox.paypal.com`). Do not switch to live real-money payments.

---

## Architecture & Serverless Compatibility Check

| Concern | Implementation | Vercel Compatibility |
|---|---|---|
| Contract & Audit Persistence | `ContractStore` switches automatically to `UpstashContractStore` (`@upstash/redis`) whenever `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set. | Fully persistent across serverless functions |
| Proof Image Uploads | Proof bytes are validated in memory (`validateProofImage`, max **4 MB**) and sent directly to Gemini `inlineData`. Only metadata (`filename`, `mimeType`, `sizeBytes`, `sha256`, `verdict`) is persisted in Redis. | No local disk writes (`/tmp` or filesystem) and safely below Vercel's 4.5 MB request body limit |
| PayPal API Calls | Server-side `fetch` with 15s `AbortSignal.timeout`, `PayPal-Request-Id` idempotency, OAuth token caching, and `GET /v2/payments/authorizations/{id}` reconciliation | Serverless-safe |
| Webhook Accessibility | Public `POST /api/paypal/webhook` verifies PayPal headers via `/v1/notifications/verify-webhook-signature` | Public HTTPS on `*.vercel.app` |
| Scheduled Expiration Sweep | `vercel.json` configures `GET /api/cron/resolve` (protected by `CRON_SECRET`), plus manual `POST /api/cron/resolve` via UI | Configured (`0 0 * * *` daily on Hobby; increase frequency on Pro) |

---

## Step 1: Create Upstash Redis Database

1. Open [Upstash Console](https://console.upstash.com/) (or install **Upstash for Redis** inside Vercel Marketplace).
2. Create a Redis database and copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

## Step 2: Deploy to Vercel

1. Push your repository to GitHub (confirm `.env` and `.data/` are NOT committed via `git status`).
2. Go to [Vercel Dashboard](https://vercel.com/new) → **Add New… → Project** → import your GitHub repository.
3. Add the following **Environment Variables** in Vercel Project Settings (Production & Preview):

| Variable | Value / Source |
|---|---|
| `PAYPAL_CLIENT_ID` | PayPal Sandbox App Client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal Sandbox App Secret (server-only) |
| `PAYPAL_BASE_URL` | `https://api-m.sandbox.paypal.com` |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | PayPal Sandbox App Client ID |
| `PAYPAL_WEBHOOK_ID` | Webhook ID from Step 3 below |
| `GEMINI_API_KEY` | Google AI Studio Gemini API Key |
| `UPSTASH_REDIS_REST_URL` | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST Token |
| `CRON_SECRET` | Random secret string for Vercel Cron |

4. Click **Deploy** and note your deployment URL (e.g., `https://stake-demo.vercel.app`).

---

## Step 3: Register Hosted PayPal Sandbox Webhook

1. Open [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox) → your Sandbox App → **Sandbox Webhooks** → **Add Webhook**.
2. Set **Webhook URL** to:
   ```text
   https://<your-vercel-domain>/api/paypal/webhook
   ```
3. Subscribe to:
   - `PAYMENT.AUTHORIZATION.CREATED`
   - `PAYMENT.CAPTURE.COMPLETED`
   - `PAYMENT.AUTHORIZATION.VOIDED`
4. Copy the generated **Webhook ID** into Vercel → **Settings → Environment Variables → `PAYPAL_WEBHOOK_ID`**.
5. **Redeploy** the latest Vercel deployment so `PAYPAL_WEBHOOK_ID` and `NEXT_PUBLIC_PAYPAL_CLIENT_ID` take effect.

---

## Production Smoke-Test Checklist

1. Visit `https://<your-vercel-domain>/api/health`:
   - Confirm `"status": "ok"`, `"storageMode": "upstash"`, `"paypalSandbox": true`, `"paypalWebhookConfigured": true`, `"geminiConfigured": true`.
2. Open `https://<your-vercel-domain>/`:
   - Confirm the 3D coin → `STaKE` hero reveal plays smoothly.
   - Confirm **Contracts Ledger** shows `STORE: UPSTASH`.
3. Create a `$5` test contract, authorize with a PayPal Sandbox Buyer account, and run:
   - One **FAIL** path (confirm capture in PayPal Sandbox Dashboard).
   - One **PASS** path (confirm void in PayPal Sandbox Dashboard).
   - Click **SYNC** on `/c/[id]` to confirm verified PayPal webhook events appear in the **Audit Trail**.
