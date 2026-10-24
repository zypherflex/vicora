# Integrations

Every external dependency sits behind an adapter in `src/server/adapters` or a service-level adapter list.
Each one is in exactly one of the states below, and the UI shows that state to users.

| State | Meaning |
|---|---|
| **Connected** | Talks to a real external service when configured |
| **Sandbox / Demonstration** | Built-in simulation, clearly labeled in the UI and data. Nothing leaves Vicora |
| **Not connected** | The adapter interface exists, but the call returns `503 NOT_CONNECTED` with what is needed to connect it |

No integration in this repository has been tested against a live third-party production service.

| Integration | State | Where | To connect |
|---|---|---|---|
| AI (Anthropic Claude) | Connected when `ANTHROPIC_API_KEY` is set; otherwise **Demonstration** rules engine | `adapters/ai.ts` | Set `ANTHROPIC_API_KEY` (and optionally `ANTHROPIC_MODEL`). Only the demo engine has been exercised by the test suite |
| Payments | **Sandbox** (default). Stripe: **Not connected** | `adapters/payments.ts` | Implement the Stripe adapter (hosted Checkout / PaymentIntents, so card data never touches Vicora) and its webhook verification; set `PAYMENTS_PROVIDER=stripe` |
| Tariff data (HTSUS rates, rulings) | **Not connected**. Duty rates are entered by the broker; the duty figure is labeled an estimate | `lib/customs.ts` | Licensed tariff data source plus broker review workflow |
| Customs filing (CBP ACE / ABI) | **Not connected**; **Demonstration** adapter available | `services/customs.ts` (`FILING_ADAPTERS`) | Requires ABI certification or an ABI software vendor, a filer code and broker credentials |
| Carrier authority (FMCSA QCMobile) | **Not connected** | `services/compliance.ts` | FMCSA web key plus an adapter that maps the response to compliance records |
| Insurance certificate monitoring | **Not connected** | `services/compliance.ts` | Contract with a certificate-monitoring provider |
| Document storage | **Local private disk** (connected). S3: **Not connected** | `adapters/storage.ts` | Implement the S3 adapter (private bucket, Block Public Access, SSE-KMS); set `STORAGE_DRIVER=s3` |
| OCR for scanned documents | **Not connected** | `adapters/ai.ts` | Text PDFs are read directly. Image-only scans return a warning |
| Email / SMS | **Not connected**. Messages go to an in-app outbox visible to platform admins | `services/comms.ts`, `services/orgs.ts` | Add an email/SMS provider adapter |
| Geocoding | **Demonstration** gazetteer (city-level coordinates for known U.S. cities/ports) | `adapters/geocode.ts` | Implement `GeocodeProvider` for a commercial geocoder |
| Map tiles | Public OpenStreetMap tiles by default; `NEXT_PUBLIC_MAP_TILE_URL=none` disables them | `components/map` | For production traffic use a tile provider you have an agreement with, per the OSM tile usage policy |
| Device GPS | Browser Geolocation API (connected). Asks the user for permission; sharing can be turned off | `components/driver` | No ELD or telematics integration |
| ELD / telematics, TMS/ERP, EDI | **Not built** | n/a | Future work |

## AI (Anthropic Claude)

AI is used in these places:

- **Document field extraction** in the customs workspace, plus **invoice line-item extraction** from
  commercial invoices. Every value carries the quote it came from.
- **Pre-filing review observations.** Added to the deterministic rule checks when a model is configured.
  Observations can only be warnings or notes (never blockers), and each must quote text that is found in
  the file, or it is dropped.
- **Classification candidates.** Up to three unverified 10-digit HTSUS candidates with a rationale and the
  facts that would decide between them. They are labeled "Unverified", are never written to a line, and
  can only be saved to a client's library as a DRAFT for a licensed broker to approve. With the
  demonstration engine there are no candidates; precedent from the client's approved library is shown
  instead.
- **Ask this file.** Answers come only from the file's passages (documents, approved extractions, lines,
  client record, deadlines) and must cite them; citations that don't match the source are removed, and an
  answer with no verified citation is replaced with a "not supported by the file" message. The
  demonstration engine does keyword retrieval and says so.
- **The shipment copilot**, which writes summaries, draft customer updates and suggested next steps.

Classification precedent matching and deadline computation are deterministic code, not AI, and show
their reasoning (shared words, part-number match, rule reference).

These rules apply whichever engine is running:

- **Uploaded document text is untrusted.** It is wrapped in delimiters. The model is told that the text
  is data, and that it must never follow instructions found inside it.
- **Responses are checked before they are kept.** Model output is parsed against a strict schema. Each
  extracted field must include a snippet that appears word for word in the source document. If the
  snippet cannot be found, the field is discarded and a warning is shown. That way every value a reviewer
  sees can be traced to its source.
- **AI output is only ever a draft.** Extractions are saved as `PENDING_REVIEW`. A customs user checks and corrects the
  values, then approves or rejects them. Only approved values can be applied to the customs entry. Copilot drafts go into the message box, and
  nothing is sent until a person presses Send.
- **AI never acts on its own.** It cannot send messages, make payments, submit filings or change
  shipments.
- **Permissions apply as usual.** Copilot context is built from the caller's role-redacted digital twin,
  so the AI sees only what that user is allowed to see. Using AI requires the `ai.use` permission.
- **No legal determinations.** The UI labels results as drafts. Tariff classification, duty and
  admissibility stay the licensed broker's decision. Vicora does not present AI output as a binding
  customs determination.

## Sandbox payments

`PAYMENTS_PROVIDER=sandbox` simulates a hosted checkout:

1. `POST /invoices/{id}/pay` creates a `PENDING` payment with `isSandbox=true`.
2. The job queue posts a signed webhook to `/api/v1/webhooks/payments/sandbox` about 1.5 seconds later.
3. The webhook marks the payment as succeeded or declined. The payer chooses which outcome to simulate.

Invoices, payments and timeline entries are all labeled "Sandbox". No money moves, and no card details
are collected or stored.

## Customs demonstration adapter

The demonstration adapter records a reference in the form `DEMO-…` and a timeline entry that reads
"[Demonstration] Filing recorded; nothing was sent to CBP". Both the demonstration adapter and a real
filing require all of the following:

- the `customs.approve` permission (licensed broker role)
- the entry in `READY_TO_FILE`, which requires every line to have been reviewed by a licensed broker and
  a pre-filing review that is current (nothing changed since it ran) with no unresolved blockers
- an explicit confirmation checkbox
