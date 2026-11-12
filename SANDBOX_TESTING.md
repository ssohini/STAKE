# Real PayPal Sandbox & Webhook Testing Checklist

> **Note:** Unit tests in `src/lib/__tests__/` run with mocked HTTP/AI doubles. Run the steps below against real PayPal Sandbox and Gemini APIs after configuring `.env`.

---

## Pre-Flight Check

1. Fill `.env` per [ENVIRONMENT_SETUP.md](ENVIRONMENT_SETUP.md).
2. Start the server:
   ```bash
   npm run dev
   ```
3. Confirm `http://localhost:3000/api/health` returns `"ready": true` and `"paypalSandbox": true`.

---

## Webhook Setup with ngrok

1. Install ngrok from [https://ngrok.com/download](https://ngrok.com/download) (or `winget install ngrok.ngrok` on Windows) and authenticate (`ngrok config add-authtoken <TOKEN>`).
2. With `npm run dev` running on port 3000, open a second terminal:
   ```bash
   ngrok http 3000
   ```
3. Copy the HTTPS Forwarding URL (e.g., `https://12ab-34cd.ngrok-free.app`).
4. Open [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/applications/sandbox) → click your Sandbox App → scroll to **Sandbox Webhooks** → **Add Webhook**:
   - **Webhook URL:** `https://12ab-34cd.ngrok-free.app/api/paypal/webhook`
   - **Select events:**
     - `PAYMENT.AUTHORIZATION.CREATED`
     - `PAYMENT.CAPTURE.COMPLETED`
     - `PAYMENT.AUTHORIZATION.VOIDED`
5. Click **Save**, copy the **Webhook ID**, paste it into `.env` as `PAYPAL_WEBHOOK_ID=...`, and restart `npm run dev`.
6. **Verify delivery:** In PayPal Dashboard → **Testing Tools** → **Webhooks Simulator**, select your webhook URL and send a test `PAYMENT.AUTHORIZATION.CREATED` event (or trigger a real Sandbox authorization below and inspect ngrok's web inspector at `http://127.0.0.1:4040` for `HTTP 200`).

---

## TEST 1: FAIL PATH (Real Capture)

1. Open `http://localhost:3000`, set stake to **$5**, goal to `"Run 5km outdoors and upload watch summary"`, deadline **15m**, beneficiary `"Electronic Frontier Foundation"`. Click **AUTHORIZE $5.00 STAKE**.
2. On `/c/[id]`, click the **PayPal** Smart Button and sign in with your **Sandbox Personal (Buyer)** account. Approve the checkout.
3. Verify the contract updates to **FUNDS HELD · AUTHORIZED**, shows an `Authorization ID`, and the **Audit Trail** logs `POST /v2/checkout/orders`, `POST /v2/checkout/orders/{id}/authorize`, and `VERIFY AUTHORIZATION`.
4. Upload an intentionally irrelevant photo (e.g., a random meme, wall, or cat picture in JPEG/PNG/WEBP under 4 MB) and click **SUBMIT PROOF TO COACH RAZOR**.
5. Verify Gemini evaluates the real image and returns `FAIL` with a factual `reason` explaining why the image does not match the 5km goal plus Coach Razor `feedback`.
6. Verify the contract updates to **CAPTURED · STAKE LOST** with a `Capture ID`.
7. Verify the **Audit Trail** displays:
   - `Proof uploaded`
   - `GEMINI ... (Coach Razor)` returning `FAIL`
   - `RESOLVE (CAPTURE)`
   - `GET /v2/payments/authorizations/{id}` verification
   - `POST /v2/payments/authorizations/{id}/capture` (`HTTP 201`)
   - `CONTRACT RESOLVED`
   - `WEBHOOK PAYMENT.CAPTURE.COMPLETED` (after clicking **SYNC**)
8. Open [PayPal Sandbox Merchant Activity](https://www.sandbox.paypal.com/mep/dashboard) (logged in as your Sandbox Business account) → **Activity → All Transactions** and confirm the **$5.00 USD Capture** appears as **Completed**.

---

## TEST 2: PASS PATH (Real Void)

1. Create a new contract with a **$5** stake and concrete verifiable goal (e.g., `"Tidy desk with empty mug on right side"`).
2. Click the **PayPal** Smart Button and approve with your **Sandbox Buyer** account.
3. Confirm status is **FUNDS HELD · AUTHORIZED**.
4. Take/upload an actual genuine photo satisfying your stated goal (JPEG/PNG/WEBP under 4 MB) and click **SUBMIT PROOF TO COACH RAZOR**.
5. Verify Gemini evaluates the real photo and returns `PASS` (`confidence >= 0.50`) with a factual explanation.
6. Verify the contract transitions to **VOIDED · YOU KEPT IT**.
7. Verify the **Audit Trail** logs `POST /v2/payments/authorizations/{id}/void` (`HTTP 204` or `200`) and (after **SYNC**) `WEBHOOK PAYMENT.AUTHORIZATION.VOIDED`.
8. Open [PayPal Sandbox Merchant Activity](https://www.sandbox.paypal.com/mep/dashboard) and confirm the authorization status is **Voided** (and $0 was captured from the buyer).

---

## TEST 3: REVIEW PATH (Safe Hold, Zero Money Moved)

1. Create a new **$5** contract (e.g., `"Write 200 words of notes in a notebook"`), authorize via PayPal Sandbox Buyer.
2. Upload an ambiguous, very dark, heavily blurred, or tightly cropped photo where text/completion cannot be fairly determined.
3. Verify Gemini returns `REVIEW` (or `confidence < 0.50`) and the server sets status to **NEEDS RETRY · $0 MOVED**.
4. Verify the **Audit Trail** logs `Marked REVIEW / needs_retry` and **zero** `/void` or `/capture` calls appear.
5. Verify in [PayPal Sandbox Activity](https://www.sandbox.paypal.com/mep/dashboard) that the authorization remains **Pending / Created** (neither captured nor voided).
6. Resubmit a clear photo before the deadline and confirm the contract can still settle cleanly!
