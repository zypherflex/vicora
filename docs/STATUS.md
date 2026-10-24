# Status

_Last updated 2026-10-24._ This is a working prototype. It is **not production-ready**. It has not been
security-audited, load-tested or deployed, and every external integration is either sandboxed,
demonstration-only or not connected (see [INTEGRATIONS.md](INTEGRATIONS.md)).

## Verified test results

All results below were run in the development container on 2026-10-24 against PostgreSQL 16 and
Node 22.

| Check | Command | Result |
|---|---|---|
| Type check | `npm run typecheck` | Pass |
| Production build | `next build` | Pass |
| Unit tests | `npm run test:unit` | **30 / 30 pass** (4 files) |
| Integration tests | `npm run test:integration` | **29 / 29 pass** (3 files) |
| Browser end-to-end | `npm run test:e2e` | **1 / 1 pass** (Chromium, about 1.5 minutes) |

### Unit tests (30)

- `tests/unit/money.test.ts` (7): integer minor units, rounding, parsing and formatting, and invoice totals with credits and partial payment.
- `tests/unit/status-and-permissions.test.ts` (9): the shipment and leg status models, effective permissions (roles, grants, revocations, org-type limits), and actor rules.
- `tests/unit/matching-and-inspection.test.ts` (5): provider match scoring and eligibility, and inspection damage validation.
- `tests/unit/security-and-ai.test.ts` (9):
  - webhook signatures (valid, tampered, expired)
  - scrypt password hashing
  - upload type sniffing
  - AI citation snippet location
  - demo extraction citations
  - document discrepancy detection
  - ETA estimate

### Integration tests (29), real database through the real service layer

**`tenant-isolation.test.ts` (9).** The queries run as the RLS-restricted database role.

- Non-party orgs see 0 shipments, invoices, payments and documents.
- A connection with no tenant context sees nothing.
- Providers see only their own quotes.
- Internal notes are hidden from the shipper.
- Cross-tenant UPDATE and INSERT are rejected by row-level security.
- The service layer returns 404 for other tenants' records.
- Broker margin and carrier cost are hidden from the shipper.
- A user in two orgs sees only the active org's view.

**`permissions-and-status.test.ts` (10).**

- Role limits hold.
- Only the executing carrier can dispatch, and only with its own drivers and equipment.
- Revocations and grants take effect immediately, and org-type limits still apply to grants.
- The last owner cannot be removed.
- Suspended members are locked out.
- Customs status and filing decisions need the licensed-broker permission and an explicit confirmation.
- The ACE adapter reports "not connected".
- Shipment transitions follow the status model and write history.
- Cancelling declines any open quotes.

**`booking-flow.test.ts` (10).**

- **Booking and quotes.** A shipment goes from draft to quote request. Quote totals are exact to the
  cent, including fractional quantities.
- **Concurrent acceptance.** Two quote acceptances fired at the same moment produce exactly one winner
  and one set of charges. Accepting the same quote again is idempotent.
- **Tender and dispatch.** A tender that another carrier tries to answer returns not found. Dispatch
  works for the right carrier.
- **Milestones.** They must happen in order, and delivery requires proof of delivery (POD).
- **Invoicing.** Invoices are built from confirmed charges, and a second invoice for the same charges
  is rejected.
- **Payment.** A sandbox payment can be replayed with the same idempotency key without creating a second
  payment. The webhook route rejects a missing, bad or tampered signature. It processes a valid event
  once and acknowledges duplicates without processing them again.
- **Close-out.** The carrier payable is approved after POD. The shipment closes, and margin works out
  to $625.00.

### End-to-end (1)

`tests/e2e/booking-to-delivery.spec.ts` runs a real browser with five separate signed-in users:

1. The shipper books through the wizard.
2. The broker quotes. The shipper is checked to never see the broker's private cost.
3. The shipper accepts the quote.
4. The broker tenders the load and sees the projected margin.
5. The carrier accepts the tender and dispatches. The carrier is checked to never see the customer price.
6. The driver, on a phone-sized screen, records each milestone and signs for delivery.
7. The broker invoices.
8. Accounts payable pays in the sandbox, and the invoice shows the payment as succeeded once the signed
   webhook is delivered.

### Also checked by hand

In the running app:

- Every page returns 200 for the roles allowed to see it, and 404 for non-parties.
- These screens were checked in screenshots:
  - command center
  - shipment dispatch tab
  - customs file
  - mobile driver view

## Features built

- **Accounts and organizations.**
  - Registration, sign-in, invitations and an org switcher.
  - 12 roles and 43 permissions, with per-member grants and revocations.
  - Suspension.
  - An audit log.
  - Platform admin overview.
- **Booking.** A wizard for FTL, LTL, vehicle transport, intermodal and port-to-door. It supports
  multiple stops, local-time stop windows, cargo or VIN-level vehicles, and customs details. Quote
  requests go to the marketplace or to invited providers, with an optional budget.
- **Quotes.** Line-item quotes in cents, plus a private cost estimate for providers. Acceptance is safe
  under concurrency, and quotes can be withdrawn or expire.
- **Freight broker.**
  - Load board.
  - Transparent provider matching that shows the score criteria, eligibility and compliance flags.
  - Tenders with expiry.
  - Margin that only the broker can see.
- **Carrier and fleet.** Drivers, equipment and trips, with vehicle assignment for auto haulers. Dispatch
  checks driver status, license expiry and equipment maintenance, and warns about equipment mismatch.
- **Driver (mobile web).**
  - Assigned loads, with navigate and call links.
  - Milestones and POD (photo, PDF or receiver name).
  - Live location sharing, which needs the driver's consent and sends a point at most every 5 minutes.
  - Manual location entry.
- **Auto transport.**
  - Pickup and delivery inspections with photos.
  - Tap-to-mark damage on a vehicle diagram.
  - Signature capture.
  - Damage records.
- **Customs broker.**
  - Broker appointment and entry intake.
  - Document requests and tasks.
  - AI extraction with citations, reviewed and approved by a person.
  - Discrepancy detection across documents.
  - Entry lines and the status workflow.
  - Filing that needs a licensed broker and a confirmation. ACE is not connected; a demonstration
    adapter is available.
- **Command center.** KPIs, a map and list view, filters, saved views, and an attention list that puts
  exceptions first, with evidence. Exception rules flag missed pickups and stale tracking.
- **Digital twin.** One shared shipment record, redacted for each role:
  - timeline and status history
  - documents and messages
  - exceptions and finance
  - customs and tracking
- **Finance.**
  - Receivable charges from accepted quotes.
  - Extra charges that need the bill-to party's approval.
  - Invoices and credit notes.
  - Sandbox payments with signed, idempotent webhooks.
  - Carrier payables gated on POD.
  - A finance report.
- **Documents.** Private storage, checks on file type and size, versioning, and review. Downloads use
  5-minute signed links bound to the user. Retention is set per org and enforced by a purge job.
- **Communication.** Shared messages and internal notes. Notifications with preferences. An email
  outbox (no external delivery).
- **AI copilot.** Summary, draft customer update and next steps, each citing its sources. Drafts go into
  the message box and are never sent automatically.
- **Customer tracking links.** Hashed tokens that expire and can be revoked. The page shows city-level
  location and customer-safe events only, and is rate limited.
- **Seed data.** 8 fictional organizations, 17 demo users and 7 shipments covering the main scenarios.
  All of it is labeled as demo data.

## Remaining work

**Before any real use**

- Connect real integrations, or remove them from the UI: Stripe, S3, email/SMS, FMCSA, and CBP ACE
  through a certified vendor. Each needs its own tests against the provider's sandbox.
- Restrict the customs **demonstration** filing adapter and the compliance demo adapter so they only
  appear for demo organizations in production. The compliance adapter is already limited to demo
  subjects; the filing adapter is not.
- Get an independent security review and penetration test. Add CSP headers. Move rate limits from the
  database to a shared store under load.
- Write a deployment design: managed Postgres with backups and point-in-time recovery, secret
  management, a separate worker process, monitoring and alerting. Per the original instructions, no
  infrastructure has been deployed. Before any AWS work, confirm the target Region and plan eligibility.
- Complete an accessibility audit (WCAG 2.1 AA) and run cross-browser tests beyond Chromium.

**Product gaps**

- Let drivers record milestones while offline and send them when back online. Add a native or PWA
  wrapper for background GPS.
- Add ELD and telematics, EDI (204/214/210) and TMS/ERP connectors.
- Add street-level geocoding and routing. Today's ETA is a straight-line estimate and is labeled as one.
- Handle multiple currencies (the schema supports it, but quotes are USD only).
- Support partial payments by card, refunds and dispute handling.
- Add customs duty calculation and tariff lookups. These need an authoritative data source and broker
  review; Vicora does not make customs determinations.
- Add more automated tests:
  - an e2e test for customs and auto inspection
  - visual regression tests
  - a test that runs AI extraction with a real model key
  - load tests

## Known limitations

- The Anthropic engine has only been exercised through code paths that also have a fallback. The test
  suite runs with the deterministic demonstration engine because no API key is configured.
- The demonstration geocoder only knows a fixed list of U.S. cities and ports.
- Map tiles come from public OpenStreetMap servers unless configured otherwise. Production use needs a
  tile provider agreement.
