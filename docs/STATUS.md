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
| Unit tests | `npm run test:unit` | **42 / 42 pass** (5 files) |
| Integration tests | `npm run test:integration` | **43 / 43 pass** (4 files) |
| Browser end-to-end | `npm run test:e2e` | **2 / 2 pass** (Chromium, about 2.5 minutes) |

### Unit tests (42)

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
- `tests/unit/customs-lib.test.ts` (12): HTS normalization, IOR masking, money parsing, duty estimate
  arithmetic, business-day deadlines, due dates from each rule's anchor, that every default rule carries a
  reference and a verification label, deadline states, precedent ranking and its reasons (including "no
  match" rather than a guess), and the readiness score.

### Integration tests (43), real database through the real service layer

**`customs-brokerage.test.ts` (14).**

- Row-level security: the brokerage sees its clients, library, rules, deadlines, reviews and Q&A; an
  unrelated carrier, another broker and the importer see none of the broker's private records; a
  cross-tenant update changes nothing.
- Lines created from the commercial invoice reuse approved precedent by part number, carry the invoice
  values, and stay unreviewed.
- Staff can draft a classification but only a licensed broker approves it; a draft cannot be applied.
- Classification assist ranks precedent with reasons and offers no AI candidates without a model key.
- Ready to file is refused with a stale review, allowed once a fresh review has no blockers, and refused
  again after any later change.
- Missing POA and bond are blockers; staff cannot clear a blocker and a licensed broker must give a reason.
- Recording release adds the entry summary deadline 10 business days later; staff cannot waive it.
- "Ask this file" cites the invoice text and is unavailable to other organizations.
- Brokerage charges follow the fee schedule ($125.00 + 3 × $4.50 + $35.00), are estimates for the
  importer to approve, need `finance.manage`, and are created only once.

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

### End-to-end (2)

`tests/e2e/customs-brokerage.spec.ts`: a licensed broker signs in and lands on the brokerage desk, opens
the entry in review, uses classification assist to apply the client's approved precedent to a new SKU,
reviews the line, re-runs the pre-filing review until it shows no open blockers, asks the file a question
and gets an answer citing the invoice, marks the entry ready to file and records a demonstration filing.

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
- **Customs brokerage (the core of the product).**
  - Brokerage desk: KPIs, entry pipeline by stage, deadlines, client compliance alerts, team workload,
    new intake.
  - Importer clients: POA (recorded, then verified by a licensed broker against a document), bond with its
    source, fee schedule, masked IOR number, and alerts for missing or expiring POA and bond.
  - Per-client classification library with draft/approve/retire, usage counts and rationale.
  - Deadline engine with editable per-brokerage rules (ISF, entry, entry summary, internal targets), each
    with its reference; deadlines can be marked met or (by a licensed broker) waived.
  - AI field extraction and invoice line-item extraction, both with quoted sources; draft lines created
    from the invoice, pre-filled from approved precedent.
  - Pre-filing review: rule checks with evidence plus AI observations, readiness score, staleness detection,
    and finding resolution. It gates ready to file.
  - Classification assist: precedent from the client's library plus unverified AI candidates.
  - Ask this file: cited answers from the file only, kept for audit.
  - Duty estimate from broker-entered rates, labeled as an estimate.
  - Brokerage billing from the client's fee schedule.
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
- **Seed data.** 8 fictional organizations, 17 demo users and 9 shipments covering the main scenarios.
  The demo brokerage has 3 importer clients (one fully set up, one onboarding, one with an expiring POA),
  an illustrative classification library labeled as demo data, two open entries and one new intake.
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
- Add tariff data (HTSUS rates, rulings) from a licensed source. Today the broker enters duty rates and
  the duty figure is an estimate; MPF, HMF, AD/CVD and Section 301 are not calculated.
- Exclude federal holidays from business-day deadlines (currently weekends only, and labeled as such).
- Add ISF filing, PGA (FDA, EPA, etc.) data, reconciliation and post-summary corrections.
- The classification library has no import/export yet, and precedent matching is word overlap, not
  semantic search.
- Add more automated tests:
  - an e2e test for auto inspection
  - visual regression tests
  - a test that runs AI extraction with a real model key
  - load tests

## Known limitations

- The Anthropic engine has only been exercised through code paths that also have a fallback. The test
  suite runs with the deterministic demonstration engine because no API key is configured, so AI
  classification candidates and AI review observations have not been run against a live model.
- The demonstration geocoder only knows a fixed list of U.S. cities and ports.
- Map tiles come from public OpenStreetMap servers unless configured otherwise. Production use needs a
  tile provider agreement.
