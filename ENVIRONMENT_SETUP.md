# Environment Setup Guide — STAKE

Never commit `.env` or real API credentials. Keep `.env` local (it is already excluded by `.gitignore`).

```bash
cp .env.example .env
```

After filling in `.env`, verify non-secret readiness at `http://localhost:3000/api/health`.

---

## 1. PayPal Sandbox Credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_BASE_URL`)

All payment operations in STAKE strictly target **PayPal Sandbox** (`https://api-m.sandbox.paypal.com`).

1. Sign in to the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox).
2. Ensure the **Sandbox** toggle at the top is selected (never Live).
3. Click **Apps & Credentials** → **Create App**.
4. Enter an app name (e.g., `stake-hackathon`), choose **Merchant** app type, select your Sandbox Business account, and click **Create App**.
5. Copy **Client ID** into BOTH:
   - `PAYPAL_CLIENT_ID=...`
   - `NEXT_PUBLIC_PAYPAL_CLIENT_ID=...`
6. Click **Show** under **Secret key 1** and copy it into:
   - `PAYPAL_CLIENT_SECRET=...` (server-only — never prefix with `NEXT_PUBLIC_`)
7. Keep:
   - `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`

### Sandbox Buyer Account (for approving holds)
1. In the PayPal Developer Dashboard left menu, open **Testing Tools** → **Sandbox Accounts**.
2. Locate the **Personal (Buyer)** account (or click **Create account** → Personal, Country `US`, initial balance `$1000+ USD`).
3. Click the `...` menu → **View/Edit account** and copy the Buyer **Email ID** and **System Generated Password**.

---

## 2. Google Gemini API Key (`GEMINI_API_KEY`)

1. Open [Google AI Studio](https://aistudio.google.com/apikey).
2. Sign in with your Google account and click **Create API key**.
3. Copy the key (`AIza...`) into `.env`:
   - `GEMINI_API_KEY=...`
4. Optional model override:
   - `GEMINI_MODEL=gemini-2.5-flash` (default)

---

## 3. PayPal Webhook ID (`PAYPAL_WEBHOOK_ID`)

See [SANDBOX_TESTING.md](SANDBOX_TESTING.md#webhook-setup-with-ngrok) for full ngrok + PayPal Dashboard instructions.

1. Start the app locally (`npm run dev`) and expose port 3000 (`ngrok http 3000`).
2. In your PayPal Sandbox App page → **Sandbox Webhooks** → **Add Webhook**:
   - **Webhook URL**: `https://<your-ngrok-domain>/api/paypal/webhook`
   - **Event types**:
     - `PAYMENT.AUTHORIZATION.CREATED`
     - `PAYMENT.CAPTURE.COMPLETED`
     - `PAYMENT.AUTHORIZATION.VOIDED`
3. Copy the generated **Webhook ID** into `.env`:
   - `PAYPAL_WEBHOOK_ID=...`
4. Restart `npm run dev` so Next.js picks up the updated `.env`.

---

## 4. Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`)

Required for Vercel / serverless deployment; optional for local development (locally STAKE defaults to `.data/contracts.json`).

1. Sign in to the [Upstash Console](https://console.upstash.com/) (or install Upstash Redis via the Vercel Marketplace integration).
2. Click **Create Database**, choose **Global** or a region close to your Vercel region, and create it.
3. On the database details page under **REST API**, copy:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

---

## 5. Cron Protection (`CRON_SECRET`) — Optional for Vercel

1. Generate any random 32-character string (e.g., `openssl rand -hex 24`).
2. Set `CRON_SECRET=...` in Vercel Environment Variables. Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when invoking `GET /api/cron/resolve`.

---

## 6. Verify Configuration

Start the server and visit:

```text
http://localhost:3000/api/health
```

Confirm:
- `"status": "ok"`
- `"paypalConfigured": true`
- `"paypalClientSdkConfigured": true`
- `"paypalSandbox": true`
- `"geminiConfigured": true`
- `"missingRequired": []` (once `PAYPAL_WEBHOOK_ID` is also added)
