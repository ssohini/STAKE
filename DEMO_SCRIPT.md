# STAKE — 2m 45s Hackathon Demo Script

**Target runtime:** Under 3 minutes  
**Pre-loaded:** Open the app URL in Chrome (incognito or clean profile), keep PayPal Sandbox Buyer email/password ready, have two proof images ready on Desktop (`clean-desk.jpg` for PASS, `random-meme.png` for FAIL), and keep [PayPal Sandbox Merchant Activity](https://www.sandbox.paypal.com/mep/dashboard) open in Tab 2.

---

## 0:00 – 0:20 | 1. Cinematic Opening Hero
- Load `/` fresh (or click **REPLAY**).
- Let the 3D US Dollar coin rocket in, spin under studio lighting, zoom out, and reveal **STaKE** with the coin forming the lowercase `'a'`.
- **Say:** *"This is STAKE — commitment contracts backed by PayPal authorization holds and evaluated by Gemini vision AI. When you commit to a goal, PayPal holds your stake without capturing a cent up front."*

## 0:20 – 0:45 | 2. Create Contract
- Click **LOCK A STAKE** to scroll cleanly into the Minecraft-inspired contract builder.
- Select **$5**, set Goal to `"Clear every dish and wipe down the kitchen counter"`, Deadline **15m**, Beneficiary `"Electronic Frontier Foundation"`.
- Click **AUTHORIZE $5.00 STAKE**.
- **Say:** *"Contracts live at a shareable `/c/[id]` URL with zero login friction. Right now status is Awaiting PayPal Auth."*

## 0:45 – 1:15 | 3. PayPal Sandbox Approval (Hold Only)
- On `/c/[id]`, click the **PayPal** Smart Button.
- Sign in with the **PayPal Sandbox Buyer** account and approve checkout.
- Point out the status flipping to **FUNDS HELD · AUTHORIZED**, the extracted `Authorization ID`, and the **Audit Trail** showing `POST /v2/checkout/orders`, `POST .../authorize`, and `VERIFY AUTHORIZATION` (amount, currency, and `custom_id` verified server-side, plus `PayPal-Debug-Id` logged).
- **Say:** *"PayPal authorized $5 with `intent=AUTHORIZE` — zero money has been captured yet."*

## 1:15 – 1:50 | 4–5 & 7. Upload Genuine Proof → Gemini PASS → PayPal Void
- Drop in `clean-desk.jpg` (or clean counter photo) and click **SUBMIT PROOF TO COACH RAZOR**.
- Show the verdict card: **PASSED — Authorization Voided, You Keep $5.00**, Coach Razor's factual `REASON` + 2-sentence feedback, and `POST /v2/payments/authorizations/{id}/void` (`HTTP 204`) in the **Audit Trail**.
- Click **SYNC** to surface the verified `WEBHOOK PAYMENT.AUTHORIZATION.VOIDED` event.
- **Say:** *"Notice the AI never touches PayPal credentials or money. Gemini returned strict JSON (`PASS`, confidence, reason, feedback), and our server verified eligibility and voided the hold."*

## 1:50 – 2:30 | 6. Fail Path → Actual PayPal Capture
- Click **REMATCH** (or **+ NEW STAKE**), create a second **$5** contract, and approve with the Sandbox Buyer.
- Upload `random-meme.png` (an intentionally unrelated image) and submit.
- Show **CAPTURED · STAKE LOST**, Coach Razor's `FAIL` verdict & `REASON`, and `POST /v2/payments/authorizations/{id}/capture` (`HTTP 201`) + `Capture ID` in the **Audit Trail**.
- Switch to Tab 2 (**PayPal Sandbox Merchant Activity**) and refresh to show the **Voided** hold from Contract 1 and the **Completed $5.00 Capture** from Contract 2.

## 2:30 – 2:45 | 8–9. Contracts Ledger & Expiration Cron Sweep
- Return to `/` and scroll to **CONTRACTS LEDGER**.
- Point out both contracts tracked in Redis/JSON and click **RESOLVE EXPIRED** (`POST /api/cron/resolve`) to demonstrate how overdue contracts without proof are automatically captured while contracts marked for **REVIEW** remain safely preserved.
- **Say:** *"Full PayPal REST v2 authorize-void-capture lifecycle, verified webhooks, strict AI isolation, and complete auditability — that's STAKE."*
