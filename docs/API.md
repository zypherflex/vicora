# API

Vicora exposes a JSON REST API under `/api/v1`. The web UI uses the same API for every change it makes,
so anything the UI can do, an API client with the same permissions can do too.

The machine-readable **OpenAPI 3.1** document is served at `GET /api/v1/openapi.json`. It is generated
from the same zod schemas that validate requests (`src/server/api/openapi.ts`).

## Conventions

**Authentication.** Sign in with `POST /api/v1/auth/login`. The response sets an `HttpOnly` session
cookie. Non-browser clients can send the same token as `Authorization: Bearer <token>`. A request acts as
one user in their *active* organization. Switch the active organization with `POST /api/v1/auth/switch-org`.

**Same-origin.** Browser requests that change data must come from the app's own origin. If the `Origin`
header is from another site, the request is rejected.

**Validation.** Request bodies are validated with zod. A body that fails validation returns `422` with
the path and message for each problem.

**Errors.** Every error has the same shape:

```json
{ "error": { "code": "NOT_FOUND", "message": "Shipment not found", "details": null, "requestId": "…" } }
```

| Code | HTTP | Meaning |
|---|---|---|
| BAD_REQUEST | 400 | Malformed request |
| UNAUTHENTICATED | 401 | No valid session |
| FORBIDDEN | 403 | Signed in, but the role does not have the permission |
| NOT_FOUND | 404 | Missing, or not visible to your organization. Vicora does not reveal whether another tenant's record exists |
| CONFLICT | 409 | Business rule blocked the action (e.g. quote already accepted) |
| INVALID_TRANSITION | 409 | Status change not allowed by the status model for your role |
| PAYLOAD_TOO_LARGE / UNSUPPORTED_MEDIA_TYPE | 413 / 415 | Upload rejected |
| VALIDATION_FAILED | 422 | Body failed schema validation |
| RATE_LIMITED | 429 | Too many requests; see `Retry-After` |
| NOT_CONNECTED | 503 | The requested integration is not connected (see INTEGRATIONS.md) |
| INTERNAL | 500 | Unexpected error (details are logged server-side, not returned) |

**Request ids.** Every response has an `x-request-id` header. You can send your own, 8–64 characters
from `[A-Za-z0-9_-]`, to correlate logs.

**Money.** All amounts are integers in minor units, for example `245000` means $2,450.00. Quantities
are in thousandths: `quantityMilli: 1500` means 1.5 units. Currency is ISO-4217. Right now that is only
`USD`.

**Times.** All times are ISO-8601 in UTC. Stop windows are entered in the stop's local time zone in the
UI and converted to UTC before they are sent.

**Idempotency.**
- `POST /invoices/{id}/pay` requires an `idempotencyKey`. A retry with the same key returns the
  original payment and does not create a second one.
- `POST /quotes/{id}/accept` is safe to retry. Concurrent acceptances are serialized, so only one quote
  can win.

**Webhooks.** `POST /api/v1/webhooks/payments/sandbox` takes the header
`x-vicora-signature: t=<unix>,v1=<hex hmac-sha256 of "t.body">`. Requests more than five minutes old are
rejected. Each provider event id is processed once; repeat deliveries return `{ "duplicate": true }`.

**Health.** `GET /api/health` reports whether the service is up and the database can be reached. It is
public and contains no tenant data.

## Example

```bash
# Sign in (stores the session cookie)
curl -c jar -H 'content-type: application/json' \
  -d '{"email":"leo@lakeshore.demo","password":"VicoraDemo!2026"}' http://localhost:3000/api/v1/auth/login

# List shipments visible to Lakeshore Home Goods
curl -b jar http://localhost:3000/api/v1/shipments

# Submit a quote as the broker (amounts in cents)
curl -b jar -H 'content-type: application/json' -d '{
  "currency":"USD","transitDays":2,"notes":null,"estimatedCostMinor":230000,
  "lines":[{"code":"LINEHAUL","description":"Linehaul","quantityMilli":1000,"unitAmountMinor":245000}]
}' http://localhost:3000/api/v1/shipments/<shipmentId>/quotes
```

## Endpoints

The Access column shows the permission the caller's active membership must have. Even with that
permission, the caller's organization must also be a party to the record; if it isn't, the API returns
`404`. Permissions are checked in the service layer. Party membership is checked there and again by the
database's row-level security policies.

### Auth

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/auth/register` | public | Register a user and organization (rate limited) |
| POST | `/api/v1/auth/login` | public | Sign in (rate limited per IP and per account) |
| POST | `/api/v1/auth/logout` | signed in | Sign out |
| GET | `/api/v1/auth/session` | signed in | Current user, memberships and permissions |
| POST | `/api/v1/auth/switch-org` | signed in | Switch the active organization |

### Team

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/invitations/{token}` | public | Look up an invitation |
| POST | `/api/v1/invitations/{token}` | public | Accept an invitation |
| GET | `/api/v1/team` | `team.read` | Members and pending invitations |
| POST | `/api/v1/team/invitations` | `team.manage` | Invite a member |
| DELETE | `/api/v1/team/invitations/{id}` | `team.manage` | Revoke an invitation |
| PATCH | `/api/v1/team/members/{id}` | `team.manage` | Change roles, permission grants/revocations or status |

### Organization

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/org` | signed in | Organization profile |
| PATCH | `/api/v1/org` | `org.manage` | Update settings (retention, service area) |

### Shipments

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/shipments` | `shipment.read` | Search shipments where your org is a party |
| POST | `/api/v1/shipments` | `shipment.create` | Create a shipment request (freight, vehicles, customs) |
| GET | `/api/v1/shipments/{id}` | `shipment.read` | Shipment digital twin (role-redacted) |
| POST | `/api/v1/shipments/{id}/status` | `shipment.update` | Validated status transition |
| POST | `/api/v1/shipments/{id}/complete` | signed in | Close a delivered shipment (provider) |
| GET | `/api/v1/views` | signed in | Saved views |
| POST | `/api/v1/views` | signed in | Save a view |
| DELETE | `/api/v1/views/{id}` | signed in | Delete a saved view |

### Quotes

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/request-quotes` | `quote.request` | Publish for quotes |
| GET | `/api/v1/loadboard` | `loadboard.read` | Open quote requests for providers |
| POST | `/api/v1/shipments/{id}/quotes` | `quote.submit` | Submit a quote |
| POST | `/api/v1/quotes/{id}/accept` | `quote.accept` | Accept a quote (idempotent, concurrency-safe) |
| POST | `/api/v1/quotes/{id}/withdraw` | `quote.submit` | Withdraw a quote |

### Providers

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/shipments/{id}/matches` | signed in | Ranked providers with criteria (?purpose=tender|invite) |

### Dispatch

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/tenders` | `tender.create` | Tender a leg to a carrier |
| GET | `/api/v1/tenders` | signed in | Incoming and outgoing tenders |
| POST | `/api/v1/tenders/{id}/respond` | `tender.respond` | Accept or decline a tender |
| POST | `/api/v1/shipments/{id}/dispatch` | `dispatch.manage` | Assign driver and equipment to a leg |

### Tracking

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/legs/{legId}/milestones` | `milestone.record` | Record a leg milestone (POD required for delivery) |
| POST | `/api/v1/shipments/{id}/location` | `location.report` | Report a location (LIVE_GPS or MANUAL) |
| POST | `/api/v1/shipments/{id}/tracking-links` | `tracking_link.manage` | Create a customer tracking link (token shown once) |
| DELETE | `/api/v1/tracking-links/{id}` | `tracking_link.manage` | Revoke a tracking link |
| GET | `/api/v1/public/tracking/{token}` | public | Public, restricted tracking view (rate limited) |

### Exceptions

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/exceptions` | `exception.manage` | Open an exception |
| PATCH | `/api/v1/exceptions/{id}` | `exception.manage` | Acknowledge or resolve an exception |
| GET | `/api/v1/attention` | signed in | Exception-first worklist with evidence |

### Documents

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/documents` | `document.upload` | Upload a document or new version (multipart) (multipart) |
| GET | `/api/v1/shipments/{id}/documents` | `document.read` | List shipment documents |
| GET | `/api/v1/org/documents` | `document.read` | List organization documents |
| POST | `/api/v1/org/documents` | `document.upload` | Upload an organization document (insurance, authority) (multipart) |
| GET | `/api/v1/documents/{id}` | `document.read` | Document with version history and extractions |
| POST | `/api/v1/documents/{id}/review` | `document.review` | Approve or reject a document |
| GET | `/api/v1/document-versions/{id}/link` | `document.read` | Issue a 5-minute signed download link bound to the user |
| GET | `/api/v1/files/{versionId}` | signed in | Download via signed link (requires session too) |
| POST | `/api/v1/shipments/{id}/document-requests` | `document.review` | Request a document from the customer |

### Communications

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/messages` | `message.write` | Post a shared message or internal note |
| GET | `/api/v1/notifications` | signed in | Your notifications |
| POST | `/api/v1/notifications/read` | signed in | Mark notifications read |
| GET | `/api/v1/notifications/preferences` | signed in | Notification preferences |
| PUT | `/api/v1/notifications/preferences` | signed in | Update preferences |

### Finance

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/charges` | `finance.manage` | Add an estimated charge (needs bill-to approval) |
| POST | `/api/v1/charges/{id}/decision` | `finance.manage` | Approve or reject an estimated charge |
| GET | `/api/v1/invoices` | `finance.read` | Invoices issued and received |
| POST | `/api/v1/invoices` | `invoice.create` | Invoice confirmed charges for a delivered shipment |
| GET | `/api/v1/invoices/{id}` | `finance.read` | Invoice detail |
| POST | `/api/v1/invoices/{id}/credits` | `finance.manage` | Apply a credit note |
| POST | `/api/v1/invoices/{id}/pay` | `payment.make` | Pay via provider adapter (sandbox; idempotency key required) |
| GET | `/api/v1/payables` | `finance.read` | Carrier payables |
| POST | `/api/v1/payables/{id}/approve` | `finance.manage` | Approve a payable (POD required) |
| POST | `/api/v1/payables/{id}/paid` | `finance.manage` | Record an off-platform payment reference |
| GET | `/api/v1/reports/finance` | `finance.read` | AR/AP, aging, monthly revenue/cost/margin per currency |
| POST | `/api/v1/webhooks/payments/sandbox` | signed webhook | Signed payment webhook (x-vicora-signature: t=…,v1=…) |

### Customs

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/customs-broker` | `shipment.update` | Appoint a customs broker |
| GET | `/api/v1/customs` | `customs.read` | Broker workspace: intake, files, tasks |
| POST | `/api/v1/shipments/{id}/customs` | `customs.manage` | Open a customs file |
| GET | `/api/v1/customs/{id}` | `customs.read` | Customs file with documents, extractions, discrepancies |
| PATCH | `/api/v1/customs/{id}` | `customs.manage` | Update a customs file |
| POST | `/api/v1/customs/{id}/status` | `customs.manage` | Change customs status (some require licensed broker) |
| POST | `/api/v1/customs/{id}/lines` | `customs.manage` | Add a broker-entered line |
| PATCH | `/api/v1/customs/{id}/lines/{lineId}` | `customs.manage` | Update / mark reviewed (customs.approve) |
| POST | `/api/v1/customs/{id}/filing` | `customs.approve` | Submit via a filing adapter (ACE not connected; demo adapter available) |
| POST | `/api/v1/documents/{id}/extractions` | `customs.manage` | Queue AI-assisted extraction |
| POST | `/api/v1/extractions/{id}/review` | `customs.manage` | Human approval of extracted fields |

### Tasks

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/tasks` | signed in | Create a task |
| POST | `/api/v1/tasks/{id}/complete` | signed in | Complete a task |

### Fleet

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/fleet` | `fleet.read` | Drivers, equipment, trips |
| POST | `/api/v1/fleet/drivers` | `fleet.manage` | Add a driver |
| POST | `/api/v1/fleet/equipment` | `fleet.manage` | Add equipment |
| PATCH | `/api/v1/fleet/equipment/{id}` | `fleet.manage` | Set equipment availability |
| POST | `/api/v1/fleet/trips` | `dispatch.manage` | Plan an auto-transport trip (capacity-checked) |
| POST | `/api/v1/fleet/trips/{id}/vehicles` | `dispatch.manage` | Load vehicles onto a trip |
| GET | `/api/v1/fleet/unassigned-vehicles` | `fleet.read` | Vehicles awaiting a trip |
| POST | `/api/v1/shipments/{id}/inspections` | `inspection.perform` | Electronic condition report with damage annotations |
| GET | `/api/v1/driver/trips` | signed in | Trips assigned to the signed-in driver |

### Compliance

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/compliance` | `compliance.read` | Your compliance records |
| POST | `/api/v1/compliance` | `compliance.manage` | Add a compliance record |
| POST | `/api/v1/compliance/{id}/verify` | `compliance.verify` | Record a verification decision |
| GET | `/api/v1/providers` | `compliance.read` | Provider directory with verification status |

### AI

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/api/v1/shipments/{id}/copilot` | `ai.use` | AI copilot: summarize, draft update, next steps (advisory) |

### Audit

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/audit` | `audit.read` | Organization audit trail |

### Platform

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/v1/admin/overview` | signed in | Platform administration overview |
| PATCH | `/api/v1/admin/orgs/{id}` | signed in | Suspend or activate an organization |
