import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addBusinessDays } from "@/lib/customs";
import { closeDb, withTenantTx } from "@/server/db/client";
import * as t from "@/server/db/schema";
import {
  applyClassification,
  askFile,
  classificationAssist,
  createClassification,
  decideClassification,
  generateBrokerageCharges,
  getClient,
  latestReview,
  resolveFinding,
  runPreflightReview,
  setDeadlineStatus,
  updateEntryDetails,
} from "@/server/services/brokerage";
import { setCustomsStatus, upsertCustomsLine } from "@/server/services/customs";
import { as } from "@/server/testing/actors";
import { codeOf, db, orgId, shipmentByRef } from "./fixtures";

/**
 * The customs brokerage core: client records, the classification library, deadlines, the pre-filing
 * review gate, grounded Q&A and brokerage billing. Runs against the seeded demo brokerage (Harborline).
 */
type Entry = typeof t.customsEntries.$inferSelect;
let entry2: Entry; // Lakeshore ceramics import, lines created from the invoice
let entry8: Entry; // Pacific Crest import, client has no POA or bond

beforeAll(async () => {
  const byRef = async (ref: string) => (await db().select().from(t.customsEntries).where(eq(t.customsEntries.shipmentId, (await shipmentByRef(ref)).id)))[0];
  entry2 = await byRef("VCR-26-001002");
  entry8 = await byRef("VCR-26-001008");
  await db().update(t.customsEntries).set({ status: "IN_REVIEW" }).where(eq(t.customsEntries.id, entry2.id));
});

afterAll(() => closeDb());

const linesOf = (entryId: string) => db().select().from(t.customsLines).where(eq(t.customsLines.entryId, entryId)).orderBy(t.customsLines.lineNumber);

describe("brokerage data is private to the brokerage (row-level security)", () => {
  async function scope(email: string, org: string) {
    const [u] = await db().select().from(t.users).where(eq(t.users.email, email));
    const id = await orgId(org);
    const [o] = await db().select().from(t.organizations).where(eq(t.organizations.id, id));
    return { orgId: id, userId: u.id, orgType: o.type };
  }
  const tables = ["customs_clients", "classification_items", "customs_deadline_rules", "customs_reviews", "customs_questions", "customs_deadlines"];
  const counts = async (s: Awaited<ReturnType<typeof scope>>) =>
    Object.fromEntries(await Promise.all(tables.map(async (tb) => [tb, Number((await withTenantTx(s, (tx) => tx.execute<{ n: number }>(sql.raw(`select count(*)::int n from ${tb}`))))[0].n)])));

  it("the brokerage sees its own records", async () => {
    const c = await counts(await scope("ruth@harborline.demo", "Harborline Customs Brokerage"));
    for (const tb of tables) expect(c[tb], tb).toBeGreaterThan(0);
  });

  it("an unrelated carrier and another broker org see none of it", async () => {
    for (const s of [await scope("ops@desertsun.demo", "Desert Sun Logistics"), await scope("dana@meridian.demo", "Meridian Freight Partners")]) {
      const c = await counts(s);
      for (const tb of tables) expect(c[tb], tb).toBe(0);
    }
  });

  it("the importer cannot see the broker's client file, library, reviews or Q&A", async () => {
    const c = await counts(await scope("maya@lakeshore.demo", "Lakeshore Home Goods"));
    for (const tb of ["customs_clients", "classification_items", "customs_deadline_rules", "customs_reviews", "customs_questions"]) expect(c[tb], tb).toBe(0);
  });

  it("cross-tenant writes are refused", async () => {
    const s = await scope("ops@desertsun.demo", "Desert Sun Logistics");
    const [client] = await db().select().from(t.customsClients).limit(1);
    const res = await withTenantTx(s, (tx) => tx.update(t.customsClients).set({ notes: "tampered" }).where(eq(t.customsClients.id, client.id)).returning());
    expect(res.length).toBe(0);
  });
});

describe("classification library", () => {
  it("lines created from the invoice reuse approved precedent by part number, but stay unreviewed until a broker confirms", async () => {
    const lines = await linesOf(entry2.id);
    expect(lines.map((l) => l.partNumber)).toEqual(["HV-DS16-BLU", "HV-DS16-GRN", "HV-MUG-4"]);
    expect(lines.map((l) => l.valueMinor)).toEqual([2_220_000, 1_776_000, 900_000]);
    expect(lines[0].htsCode).toBe("6912.00.4810");
    expect(lines[0].classificationItemId).not.toBeNull();
    expect(lines[1].htsCode).toBeNull();
  });

  it("only a licensed broker approves; staff drafts; drafts cannot be applied", async () => {
    const draft = await as("ben@harborline.demo", (c) =>
      createClassification(c, { clientId: entry2.clientId!, partNumber: "TEST-1", description: "Stoneware dinnerware 16pc green", htsCode: "6912.00.4810", countryOfOrigin: "VN", rationale: null, source: "BROKER" }),
    );
    expect(draft.status).toBe("DRAFT");
    const green = (await linesOf(entry2.id))[1];
    expect(await codeOf(as("ruth@harborline.demo", (c) => applyClassification(c, entry2.id, green.id, draft.id)))).toBe("CONFLICT");
    expect(await codeOf(as("ben@harborline.demo", (c) => decideClassification(c, draft.id, "APPROVED")))).toBe("FORBIDDEN");
    await as("ruth@harborline.demo", (c) => decideClassification(c, draft.id, "RETIRED"));
  });

  it("classification assist offers ranked precedent with reasons and no AI candidates without a model key", async () => {
    const green = (await linesOf(entry2.id))[1];
    const r = await as("ben@harborline.demo", (c) => classificationAssist(c, entry2.id, green.id));
    expect(r.precedents[0].item.partNumber).toBe("HV-DS16-BLU");
    expect(r.precedents[0].reasons.join(" ")).toMatch(/Shared words/);
    expect(r.ai.candidates).toEqual([]);
    expect(r.ai.note).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("another brokerage cannot read the client", async () => {
    expect(await codeOf(as("ruth@harborline.demo", (c) => getClient(c, entry2.clientId!)))).toBe("OK");
    expect(await codeOf(as("dana@meridian.demo", (c) => getClient(c, entry2.clientId!)))).not.toBe("OK");
  });
});

describe("pre-filing review gates ready-to-file", () => {
  it("blocks until a current review has no open blockers", async () => {
    const lines = await linesOf(entry2.id);
    const green = lines[1];
    // Licensed broker classifies and reviews the new SKU (illustrative number for the test).
    await as("ruth@harborline.demo", (c) =>
      upsertCustomsLine(c, entry2.id, { partNumber: green.partNumber, description: green.description, htsCode: "6912.00.4810", quantity: green.quantity, valueMinor: green.valueMinor, countryOfOrigin: "VN", dutyRateBp: null, brokerReviewed: true }, green.id),
    );
    // The seeded review predates that change, so it is stale.
    expect(await codeOf(as("ruth@harborline.demo", (c) => setCustomsStatus(c, entry2.id, { status: "READY_TO_FILE" })))).toBe("CONFLICT");

    const review = await as("ruth@harborline.demo", (c) => runPreflightReview(c, entry2.id));
    expect(review.findings.filter((f) => f.severity === "BLOCKER" && !f.resolution)).toEqual([]);
    expect(review.findings.every((f) => f.origin === "RULE")).toBe(true);
    for (const f of review.findings) expect(f.title.length).toBeGreaterThan(0);

    // Any change to the file after the review makes it stale again.
    await as("ruth@harborline.demo", (c) =>
      upsertCustomsLine(c, entry2.id, { partNumber: green.partNumber, description: green.description, htsCode: "6912.00.4810", quantity: 961, valueMinor: green.valueMinor, countryOfOrigin: "VN", dutyRateBp: null, brokerReviewed: true }, green.id),
    );
    const err = await as("ruth@harborline.demo", (c) => setCustomsStatus(c, entry2.id, { status: "READY_TO_FILE" })).catch((e) => e as Error);
    expect((err as Error).message).toMatch(/changed since the last review/);

    await as("ruth@harborline.demo", (c) => runPreflightReview(c, entry2.id));
    await as("ruth@harborline.demo", (c) => setCustomsStatus(c, entry2.id, { status: "READY_TO_FILE" }));
    const [after] = await db().select().from(t.customsEntries).where(eq(t.customsEntries.id, entry2.id));
    expect(after.status).toBe("READY_TO_FILE");

    // Restore the seeded state other tests rely on (one unreviewed line, file in review).
    await as("ruth@harborline.demo", (c) => setCustomsStatus(c, entry2.id, { status: "IN_REVIEW" }));
    await as("ruth@harborline.demo", (c) =>
      upsertCustomsLine(c, entry2.id, { partNumber: green.partNumber, description: green.description, htsCode: null, quantity: green.quantity, valueMinor: green.valueMinor, countryOfOrigin: "VN", dutyRateBp: null, brokerReviewed: false }, green.id),
    );
  });

  it("flags missing POA and bond, and only a licensed broker can clear a blocker, with a reason", async () => {
    const review = await as("ben@harborline.demo", (c) => runPreflightReview(c, entry8.id));
    const codes = review.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["CLIENT:POA_MISSING", "CLIENT:BOND_NONE", "NO_LINES", "DOC_MISSING:COMMERCIAL_INVOICE"]));
    const blocker = review.findings.find((f) => f.code === "CLIENT:POA_MISSING")!;
    expect(blocker.evidence[0].kind).toBe("client");
    expect(await codeOf(as("ben@harborline.demo", (c) => resolveFinding(c, entry8.id, { findingId: blocker.id, status: "RESOLVED", note: "ok" })))).toBe("FORBIDDEN");
    expect(await codeOf(as("ruth@harborline.demo", (c) => resolveFinding(c, entry8.id, { findingId: blocker.id, status: "RESOLVED", note: null })))).toBe("VALIDATION_FAILED");
    await as("ruth@harborline.demo", (c) => resolveFinding(c, entry8.id, { findingId: blocker.id, status: "RESOLVED", note: "Signed POA received by email; upload pending (test)." }));
    const latest = await as("ruth@harborline.demo", (c) => latestReview(c, entry8.id));
    expect(latest!.findings.find((f) => f.id === blocker.id)!.resolution?.note).toMatch(/Signed POA/);
    const open = (fs: typeof review.findings) => fs.filter((f) => f.severity === "BLOCKER" && !f.resolution).length;
    expect(open(latest!.findings)).toBe(open(review.findings) - 1);
  });
});

describe("deadlines", () => {
  it("recording release adds the entry summary deadline, 10 business days later", async () => {
    const released = new Date("2026-10-22T15:00:00Z");
    await as("ben@harborline.demo", (c) => updateEntryDetails(c, entry8.id, { releasedAt: released }));
    const [d] = await db().select().from(t.customsDeadlines).where(and(eq(t.customsDeadlines.entryId, entry8.id), eq(t.customsDeadlines.ruleKey, "ENTRY_SUMMARY")));
    expect(d.dueAt.toISOString()).toBe(addBusinessDays(released, 10).toISOString());
    expect(d.reference).toMatch(/19 CFR 142\.12/);
    expect(await codeOf(as("ben@harborline.demo", (c) => setDeadlineStatus(c, d.id, { status: "WAIVED", note: null })))).toBe("FORBIDDEN");
    await as("ben@harborline.demo", (c) => setDeadlineStatus(c, d.id, { status: "MET", note: null }));
    await as("ben@harborline.demo", (c) => updateEntryDetails(c, entry8.id, { releasedAt: null }));
  });
});

describe("ask this file", () => {
  it("answers only with citations that appear in the file", async () => {
    const q = await as("ben@harborline.demo", (c) => askFile(c, entry2.id, "What is the total invoice value?"));
    expect(q.engine).toBe("demo-rules");
    expect(q.citations.length).toBeGreaterThan(0);
    expect(q.citations.some((c) => c.snippet.includes("48,960.00"))).toBe(true);
  });
  it("is not available to other organizations", async () => {
    expect(await codeOf(as("dana@meridian.demo", (c) => askFile(c, entry2.id, "total?")))).not.toBe("OK");
  });
});

describe("brokerage billing", () => {
  it("creates estimated charges from the fee schedule once, for the importer to approve", async () => {
    expect(await codeOf(as("ben@harborline.demo", (c) => generateBrokerageCharges(c, entry2.id)))).toBe("FORBIDDEN");
    const rows = await as("ruth@harborline.demo", (c) => generateBrokerageCharges(c, entry2.id));
    expect(rows.map((r) => [r.description, r.amountMinor])).toEqual([
      ["Customs entry preparation", 125_00],
      ["Entry lines (3)", 13_50],
      ["Importer Security Filing", 35_00],
    ]);
    expect(rows.every((r) => r.status === "ESTIMATED" && r.code === "CUSTOMS_BROKERAGE")).toBe(true);
    expect(await codeOf(as("ruth@harborline.demo", (c) => generateBrokerageCharges(c, entry2.id)))).toBe("CONFLICT");
    // Leave the seeded finances as they were for other tests.
    await db().update(t.charges).set({ status: "VOID" }).where(eq(t.charges.sourceId, entry2.id));
  });
});
