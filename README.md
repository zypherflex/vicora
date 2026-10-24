# Vicora

Vicora is a multi-party U.S. logistics platform. Shippers, customs brokers, freight brokers, carriers,
auto transport companies and drivers work on one shared shipment record (the "digital twin"). Each
party sees only what its role and organization are allowed to see.

> **Status: working prototype, not production-ready.** All organizations, people and shipments in the
> seed data are fictional and labeled as demo data. Payments run in a labeled **sandbox** (no money moves),
> customs filing has a labeled **demonstration** adapter (nothing is sent to CBP), and several integrations
> are deliberately shown as **Not connected**. See [docs/STATUS.md](docs/STATUS.md) for what is built,
> what was verified and what remains.

## What's in the box

- **Booking and quotes.** A booking wizard for FTL, LTL, auto transport, intermodal and port-to-door.
  It has a marketplace or invited quote requests, line-item quotes in integer cents, and concurrency-safe
  acceptance.
- **Freight broker tools.** A load board, transparent provider matching (scored with visible criteria),
  tenders to carriers, and margin that only the broker sees.
- **Carrier and driver tools.** Fleet (drivers, equipment, trips) and dispatch. A mobile driver view with
  milestones, proof of delivery (photo, PDF or signature), and GPS, manual or demo location.
- **Auto transport.** VIN-level vehicles, pickup and delivery inspections, tap-to-mark damage and photos.
- **Customs broker workspace.** Entries, tasks and document requests. AI-assisted field extraction cites
  its source and needs a human to approve it. Filing requires a licensed broker and an explicit
  confirmation.
- **Command center.** KPIs, a map and list, saved views, and an attention list that puts exceptions first.
- **Finance.** Charges, invoices, credit notes, sandbox payments with signed and idempotent webhooks,
  and carrier payables gated on proof of delivery.
- **Communications and documents.** Shared messages and internal notes, notifications, and private
  document storage. Downloads use signed, user-bound links, and documents follow per-org retention.
- **AI copilot.** Summaries, draft customer updates and next steps, each with source references.
  Nothing is sent without a person clicking Send.
- **Customer tracking links.** Revocable and expiring. They show city-level location only.

## Requirements

- Node.js 20+ (developed on 22)
- PostgreSQL 15+ (developed on 16)

## Setup

```bash
npm install

# 1. Create roles and databases (as a PostgreSQL superuser).
#    vicora_owner owns the schema; vicora_app is the restricted, RLS-enforced role used by web requests.
psql "postgres://postgres@localhost:5432/postgres" -f scripts/setup-db.sql

# 2. Configure the environment.
cp .env.example .env
#    Set APP_SECRET to 32+ random characters, e.g.  openssl rand -base64 48
#    The local passwords in .env.example match scripts/setup-db.sql. Change both for anything shared.

# 3. Apply migrations (schema + row-level security policies), then load the fictional demo data.
npm run db:migrate
npm run db:seed          # wipes all data first; refuses to run when NODE_ENV=production

# 4. Run the app.
npm run dev              # http://localhost:3000
```

`npm run db:reset` drops and recreates the schema. In production, set `JOBS_IN_PROCESS=false` and run the
background worker separately with `npm run worker`.

### Demo sign-ins

All demo users share the password `VicoraDemo!2026`.

| User | Organization (fictional) | Role |
|---|---|---|
| maya@lakeshore.demo | Lakeshore Home Goods (shipper) | Owner |
| leo@lakeshore.demo | Lakeshore Home Goods | Shipping coordinator |
| ap@lakeshore.demo | Lakeshore Home Goods | Accounting |
| kim@pacificcrest.demo | Pacific Crest Motors (shipper, vehicles) | Owner |
| ruth@harborline.demo | Harborline Customs Brokerage | Owner, licensed broker |
| ben@harborline.demo | Harborline Customs Brokerage | Customs staff |
| dana@meridian.demo | Meridian Freight Partners (broker) | Owner, broker agent |
| sam@meridian.demo / priya@meridian.demo | Meridian Freight Partners | Accounting / compliance |
| ops@ironwood.demo | Ironwood Transport (carrier) | Dispatcher |
| carlos@ironwood.demo | Ironwood Transport | Driver (use a phone-sized window) |
| ops@desertsun.demo, ops@bluegrass.demo | Other carriers | Dispatcher |
| jay@redline.demo / tasha@redline.demo | Redline Auto Carriers | Dispatcher / driver |
| alex@consult.demo | Lakeshore and Meridian | Viewer and compliance (multi-org) |
| admin@vicora.demo | Platform administration | Platform admin |

The seed contains 7 shipments:

- an FTL load in transit
- a customs import with document discrepancies
- an auto transport load that has been picked up
- a paid LTL load
- a missed pickup that raises an exception
- an open vehicle request
- a reefer draft

## Tests

```bash
npm run typecheck
npm run test:unit          # pure logic: money, status model, permissions, matching, signatures, AI guards
npm run test:integration   # against vicora_test: RLS isolation, permissions, transitions, quote race, webhooks, full flow
npm run test:e2e           # Playwright: booking → delivery → invoice → sandbox payment in a real browser
```

The integration and e2e suites reset and seed the separate `vicora_test` database using `.env.test`.
That file holds test-only credentials. The e2e suite starts its own server on port 3100 with a separate
build directory, so it can run next to `npm run dev`.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system design, tenancy and security model
- [docs/API.md](docs/API.md): REST API conventions and endpoint list (the OpenAPI document is at `/api/v1/openapi.json`)
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): each external integration and its connection state
- [docs/STATUS.md](docs/STATUS.md): features, verified test results and remaining work
