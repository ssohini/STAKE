# STAKE — Devpost Hackathon Submission

## Project Title
**STAKE**

## Tagline
Put real skin in the game: PayPal authorization holds settled by vision AI — prove your commitment before the clock runs out, or forfeit your stake.

---

## Inspiration
Goals fail when there is zero consequence for quitting. Traditional accountability apps rely on honor systems or clunky upfront charges with slow manual refunds. We realized **PayPal's `AUTHORIZE`-then-`VOID`/`CAPTURE` lifecycle** maps directly to commitment escrow: lock funds at zero upfront settlement cost, let an objective AI judge evaluate photo proof, void the hold if you succeed, or capture it if you bail.

## What It Does
1. **Create a Commitment Contract:** Pick a stake (`$5–$50 USD`), a concrete verifiable goal, a beneficiary label (friend or charity), and a deadline (`1 minute – 3 days`, aligned with PayPal's ~3-day authorization honor window).
2. **Authorize Hold via PayPal:** The user approves a PayPal Smart Button checkout with `intent=AUTHORIZE`. Funds are held without being captured.
3. **Upload Photo Proof:** Before the deadline, the user uploads a JPEG, PNG, or WEBP proof photo (validated for size, extension, MIME type, and actual binary signatures).
4. **AI Evaluation (Coach Razor):** Google Gemini (`gemini-2.5-flash`) evaluates the photo against the goal and returns strict JSON (`verdict: "PASS" | "FAIL" | "REVIEW"`, `confidence`, `reason`, `feedback`).
5. **Deterministic Server Settlement:**
   - `PASS` (`confidence >= 0.50`) → Server verifies authorization eligibility and calls PayPal **Void** (`/v2/payments/authorizations/{id}/void`). User keeps their money.
   - `FAIL` (`confidence >= 0.50`) → Server verifies authorization eligibility and calls PayPal **Capture** (`/v2/payments/authorizations/{id}/capture`). Stake is forfeited.
   - `REVIEW`, low confidence (`< 0.50`), malformed output, or AI outage → Contract enters **REVIEW (`needs_retry`)**; zero money moves and the authorization is preserved.
6. **Verified Audit Trail & Cron Expiration:** Every PayPal REST call (with `PayPal-Debug-Id`), AI decision, and verified PayPal webhook (`PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.AUTHORIZATION.VOIDED`) is recorded in a secret-redacted Audit Trail. Overdue unfunded or unsubmitted contracts can be swept via `POST /api/cron/resolve`.

## How It Works
- **Opening Experience:** A custom Three.js WebGL 3D metallic US Dollar coin enters from the right, rotates under studio reflections, zooms out to lowercase `'a'` bowl scale, and reveals the **STaKE** wordmark.
- **Block Escrow UI:** Below the hero, a sharp-edged Black/White/Yellow Minecraft-inspired block interface exposes the Contract Builder, Contracts Ledger, and shareable `/c/[id]` workbench.
- **AI Isolation Boundary:** The Gemini module has zero access to PayPal credentials or APIs. Goal text is passed strictly as serialized untrusted JSON data, and the server enforces schema validation, confidence thresholds, per-contract locks, and PayPal amount/currency checks before any money moves.

## PayPal Integration
Built directly on **PayPal REST API v2** (Sandbox) and **PayPal JS SDK Smart Buttons (`intent=authorize`)**:
- `POST /v1/oauth2/token` (in-memory token caching + single-flight request coalescing)
- `POST /v2/checkout/orders` (`intent: "AUTHORIZE"`, `custom_id`, `PayPal-Request-Id` idempotency)
- `POST /v2/checkout/orders/{id}/authorize` (extracts `purchase_units[0].payments.authorizations[0].id` + verifies amount, currency, and contract match)
- `GET /v2/payments/authorizations/{id}` (pre-settlement eligibility checks + transient timeout state reconciliation)
- `POST /v2/payments/authorizations/{id}/void` & `/capture` (deterministic `PayPal-Request-Id` keys, handles HTTP `204` & `200`/`201`)
- `POST /v1/notifications/verify-webhook-signature` (cryptographic webhook verification with event-ID deduplication)

## AI Implementation
Powered by **Google Gemini (`@google/genai`, `gemini-2.5-flash`)** using structured JSON schema output (`responseMimeType: "application/json"`). Coach Razor is prompted to reject unrelated images, memes, stock photos, screenshots of screenshots, and in-image prompt injections, while honestly returning `REVIEW` when visual evidence is ambiguous.

## Technologies Used
- **Frontend & Framework:** Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, Three.js WebGL
- **Payments:** PayPal REST API v2 (Sandbox), PayPal JS SDK (`@paypal/paypal-js`)
- **AI:** Google Gemini (`@google/genai`)
- **Persistence:** `ContractStore` abstraction supporting Upstash Redis (`@upstash/redis`) on Vercel and locked JSON storage locally
- **Testing:** Vitest

## Challenges We Solved
- **Preventing AI Prompt Injection & False Captures:** Separating the Gemini module from PayPal, passing user goals strictly as untrusted JSON data, validating image binary signatures (against SVG/HTML polyglots), and routing uncertain/failed AI calls to `REVIEW` instead of capturing funds.
- **Idempotency & Timeout Reconciliation:** Guarding against double capture/void with per-contract locks (`Upstash` NX locks / in-memory queues), deterministic `PayPal-Request-Id` headers, and `GET /v2/payments/authorizations/{id}` state reconciliation if a network timeout happens mid-settlement.
- **Serverless Compatibility:** Streaming proof images in memory within Vercel's payload limits instead of relying on ephemeral local disk uploads.

## Accomplishments
- Implemented the full authorize-verify-void/capture PayPal v2 state machine with live `PayPal-Debug-Id` audit logging.
- Built a cohesive visual identity pairing a real-time 3D WebGL coin reveal with a crisp Black/White/Yellow Minecraft-inspired pixel UI.
- Covered validation, PayPal verification, webhook deduplication, `REVIEW` preservation, and timeout reconciliation with 35 unit tests (mocked HTTP/AI layer) plus complete Sandbox manual verification docs.

## Impact
Transforms PayPal authorization holds into a general-purpose micro-escrow primitive for habit tracking, study accountability, fitness challenges, and peer wagers without touching user funds unless a contract demonstrably fails.

## Future Scope
- Peer/challenger contracts where friends co-fund an opposing stake authorization.
- Multi-checkpoint recurring contracts (e.g., 7-day streaks backed by incremental re-authorizations).
- Optional beneficiary charity payout routing via PayPal Payouts API upon capture.
