# Architecture

## Overview

```
Browser (Next.js App Router, React 19, Tailwind)
   │  server components read through the service layer (RLS-scoped)
   │  client components mutate via fetch → /api/v1/*
   ▼
Route handlers (src/app/api/v1)  ── authed()/publicRoute(): session, same-origin check, rate limits, zod validation, error mapping
   ▼
Service layer (src/server/services)  ── permission checks, business rules, status model, audit + timeline events
   ▼
PostgreSQL 16 via Drizzle ORM
   ├─ vicora_app   (web requests) ── every query runs in a transaction with app.org_id / app.user_id set; RLS enforced
   └─ vicora_owner (migrations, seed, background jobs, signed webhooks, auth lookups, public tracking-token lookups)
Adapters (src/server/adapters): storage, payments, AI, geocoding. Each is real, sandbox/demo, or "not connected".
Jobs (src/server/jobs/worker.ts): Postgres-backed queue (SKIP LOCKED). It runs in-process in development or as `npm run worker`.
```

| Path | Contents |
|---|---|
| `src/lib` | Pure, shared domain code: status model, permissions, money, time zones |
| `src/server/db/schema.ts` | The full relational schema |
| `drizzle/0000_init.sql` | Generated schema migration |
| `drizzle/0001_rls.sql` | Row-level security policies, generated from `scripts/gen-rls.mjs` |
| `src/server/validators.ts` | Every request body schema (zod). The same schemas generate the OpenAPI document |
| `src/server/services/*` | Business logic, one module per area |
| `src/app/(app)/*` | Authenticated UI |
| `src/app/(auth)/*` | Sign-in, registration, invitations |
| `src/app/t/[token]` | Public tracking page |

## Multi-org tenancy

- **Organizations and memberships.** A user can belong to several organizations. One membership is the
  *active* org for a session, and the org switcher changes it. Every request acts as exactly one user in
  exactly one org.
- **Org types.** These are SHIPPER, CUSTOMS_BROKER, FREIGHT_BROKER, CARRIER and AUTO_TRANSPORT. The org
  type limits which permissions can ever apply. For example, a shipper cannot submit quotes even if a
  member is granted `quote.submit`.
- **Granular permissions.** There are 43 permissions. A member's effective permissions are worked out in
  three steps:
  1. Take the union of their roles' permissions and any explicit grants.
  2. Remove any explicit revocations.
  3. Keep only what the org type allows.

  This is computed in `src/lib/permissions.ts` and enforced in every service function.
- **Shipment parties.** A shipment has an owner org (the customer). Other orgs join as parties when they
  win a quote, accept a tender or are appointed as customs broker. Providers get a *limited preview*
  of open quote requests and outstanding tenders. The preview covers lane, timing and cargo only.

## Tenant isolation (defense in depth)

1. **Service layer.** Every function checks permissions and party membership. Requests for records
   outside the org return `404`, not `403`, so the existence of other tenants' records is not revealed.
2. **Database.** Every tenant table has PostgreSQL row-level security policies for the `vicora_app` role.
   That role is `NOBYPASSRLS`. The policies read `app.org_id`, which `withTenantTx` sets per transaction.
   With no context set, queries return nothing. `SECURITY DEFINER` helpers (`app_is_party`,
   `app_can_preview`, `app_is_customer`) avoid recursive policy checks.
3. **Field-level redaction.** Rows that are visible can still carry fields for one party only:
   - A broker's carrier rate, margin and private cost estimate are removed for everyone else.
   - Internal notes, and the `INTERNAL` visibility on messages and documents, stay inside the authoring org.
   - Timeline events can be private to one org (`visible_to_org_id`).

The integration suite (`tests/integration/tenant-isolation.test.ts`) tests both layers. It queries as
`vicora_app` directly and checks that the database itself refuses cross-tenant reads and writes.

## Shipment model

- **Status model.** Shipments move through these statuses:
  - DRAFT
  - QUOTE_REQUESTED
  - BOOKED
  - ASSIGNED
  - DISPATCHED
  - PICKED_UP
  - IN_TRANSIT
  - DELIVERED
  - COMPLETED, with CANCELLED possible where the model allows it

  Each allowed transition names who may perform it (customer, provider, executor or system).
  `transitionShipment` is the only code path that changes status. It writes status history, a timeline
  event and an audit record.
- **Legs.** Legs carry the execution status (PLANNED → TENDERED → ACCEPTED → DISPATCHED → AT_PICKUP →
  PICKED_UP → IN_TRANSIT → AT_DELIVERY → DELIVERED). Shipment status is derived from leg progress.
  Delivery requires proof: either a POD document or the name of the person who signed.
- **Digital twin.** `getShipmentTwin` assembles everything about a shipment for the current viewer:
  - stops, items and vehicles
  - legs, driver and equipment
  - quotes and tenders
  - status history and timeline
  - documents, location pings and exceptions
  - messages, charges and invoices
  - customs and inspections
  - tracking links

  Every part is redacted by role.

## Money

All amounts are integers in minor units (cents), stored as `bigint`. Quantities are in thousandths
(`quantityMilli`). Line amounts use `lineAmount(qtyMilli, unitMinor)`, which rounds half away from zero
once per line. Invoice totals are computed by `computeInvoiceTotals` from the lines, credits and amount
paid. Floats are never used for money.

## Payments

`payInvoice` requires an idempotency key, which is scoped per org. Replaying the same key returns the
original payment. The provider adapter creates the payment, and the result arrives later by webhook.
The webhook route:

1. Verifies an HMAC-SHA256 signature over the timestamp and raw body. It allows ±5 minutes of clock
   difference and compares in constant time.
2. Validates the payload.
3. Records the provider event id in `webhook_events` under a unique constraint, so duplicate deliveries
   are acknowledged but not processed again.
4. Updates the payment and invoice in a single transaction.

Vicora never sees or stores card data.

## Documents

Files live in private storage outside the web root. Uploads are checked by magic bytes against an
allow-list, and their size is capped. Downloads take two steps:

1. Request a 5-minute HMAC-signed link that is bound to the requesting user.
2. Fetch it while still signed in.

A RLS check is applied again at download time. Each org sets its own retention period, and a daily job
purges expired file contents but keeps the metadata.

## AI

See [INTEGRATIONS.md](INTEGRATIONS.md#ai-anthropic-claude). Summary of the rules:

- **Uploaded text is untrusted.** It is delimited and passed as data, never as instructions.
- **Outputs are checked.** Outputs are schema-validated. Every extracted field must quote a snippet that
  literally appears in the source, or the field is dropped.
- **Results are drafts.** They only take effect when a permitted person approves them. Messages are
  never sent automatically.
- **Filings need a licensed broker.** A filing additionally needs the licensed-broker permission and an
  explicit confirmation.
- **Not a customs determination.** AI output is labeled as a draft for review, never as a binding
  customs determination.

## Auth and web security

- **Passwords.** Passwords are hashed with scrypt.
- **Sessions.** Session tokens are random. Only their SHA-256 is stored, and the cookie is `HttpOnly`,
  `SameSite=Lax`, and `Secure` on HTTPS.
- **Request checks.** Mutating API requests must pass a same-origin check.
- **Rate limits.** Login, registration, the public tracking page and webhooks are rate limited per IP
  and, for login, per account.
- **Headers.** Security headers are set in `next.config.ts`.

## Background jobs

Jobs are rows in the `jobs` table. Workers claim them with `FOR UPDATE SKIP LOCKED` and retry them with
backoff. The job types are:

- notification fan-out
- sandbox webhook delivery
- AI extraction
- exception rules (missed pickups, stale tracking)
- compliance expiry checks
- document retention purge
