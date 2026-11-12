# STAKE — Pre-Demo Verification Checklist

Complete these checks 15 minutes before presenting or recording the demo video:

- [ ] **Health Check:** Open `/api/health` and confirm `"status": "ok"`, `"paypalConfigured": true`, `"paypalClientSdkConfigured": true`, `"paypalSandbox": true`, `"geminiConfigured": true`.
- [ ] **Storage Mode:** On hosted Vercel demo, confirm **Contracts Ledger** shows `STORE: UPSTASH` (or `STORE: JSON` for local recording).
- [ ] **Webhook Active:** Confirm `PAYPAL_WEBHOOK_ID` matches your active HTTPS webhook URL (`https://<domain>/api/paypal/webhook`) subscribed to `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, and `PAYMENT.AUTHORIZATION.VOIDED`.
- [ ] **Sandbox Accounts Ready:**
  - [ ] Sandbox Personal (Buyer) email & password copied to clipboard manager and verified able to sign in (disable 2FA prompt in PayPal Sandbox if needed).
  - [ ] Sandbox Business (Merchant) Activity tab open and logged in at `https://www.sandbox.paypal.com/mep/dashboard`.
- [ ] **Proof Assets Ready (< 4 MB, `.jpg` / `.png` / `.webp`):**
  - [ ] 1 genuine proof photo matching your demo goal (`PASS` path).
  - [ ] 1 clearly unrelated meme/photo (`FAIL` path).
  - [ ] 1 dark/blurry/ambiguous photo (`REVIEW` path, if asked in Q&A).
- [ ] **Browser Cleanliness:** Close extra extensions/overlays; test at `1440×900` or `1280×800` so the 3D coin reveal and square block UI frame cleanly.
- [ ] **No Secrets Visible:** Never open `.env` or Vercel Env Settings tabs during screen sharing.
