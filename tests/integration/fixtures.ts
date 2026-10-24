import { eq, sql } from "drizzle-orm";
import { systemDb } from "@/server/db/client";
import * as t from "@/server/db/schema";
import { AppError } from "@/server/http/errors";
import type { CreateShipmentInput } from "@/server/validators";

export const db = () => systemDb();
const now = Date.now();
export const h = (hours: number) => new Date(now + hours * 3600_000);

export async function orgId(name: string) {
  const [o] = await db().select().from(t.organizations).where(eq(t.organizations.name, name));
  if (!o) throw new Error(`No org ${name}`);
  return o.id;
}

export async function shipmentByRef(ref: string) {
  const [s] = await db().select().from(t.shipments).where(eq(t.shipments.reference, ref));
  if (!s) throw new Error(`No shipment ${ref}`);
  return s;
}

export async function legsOf(shipmentId: string) {
  return db().select().from(t.shipmentLegs).where(eq(t.shipmentLegs.shipmentId, shipmentId)).orderBy(t.shipmentLegs.seq);
}

export async function driverId(name: string) {
  const [d] = await db().select().from(t.drivers).where(eq(t.drivers.name, name));
  return d.id;
}

export async function unitId(unitNumber: string) {
  const [e] = await db().select().from(t.equipment).where(eq(t.equipment.unitNumber, unitNumber));
  return e.id;
}

/** Resolves to the AppError code a service threw, or "OK". */
export async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
}

export const line = (code: string, description: string, dollars: number, qty = 1000) => ({
  code: code as "LINEHAUL",
  description,
  quantityMilli: qty,
  unitAmountMinor: Math.round(dollars * 100),
});

export function ftlInput(title: string, submit = true): CreateShipmentInput {
  const stop = (kind: "PICKUP" | "DELIVERY", name: string, city: string, state: string, start: Date, end: Date) => ({
    kind, name, city, state: state as "IL", windowStart: start, windowEnd: end,
    address1: null, postalCode: null, contactName: null, contactPhone: null, reference: null, notes: null,
  });
  return {
    serviceType: "FTL",
    title,
    customerReference: "TEST-PO",
    requiresCustoms: false,
    commodity: "Test cargo (fictional)",
    equipmentType: "DRY_VAN",
    accessorials: [],
    hazmat: false,
    temperatureMinF: null,
    temperatureMaxF: null,
    specialInstructions: null,
    currency: "USD",
    targetBudgetMinor: null,
    quoteVisibility: "MARKETPLACE",
    invitedProviderOrgIds: [],
    stops: [stop("PICKUP", "Test origin", "Joliet", "IL", h(24), h(28)), stop("DELIVERY", "Test destination", "Dallas", "TX", h(60), h(64))],
    items: [{ description: "Pallets", quantity: 10, packaging: "PALLET", lengthIn: 48, widthIn: 40, heightIn: 60, weightLb: 9000, freightClass: null, stackable: true, hazmat: false }],
    vehicles: [],
    submit,
  } as CreateShipmentInput;
}

export async function rawAsApp<T>(scope: { orgId: string; userId: string; orgType: string }, q: ReturnType<typeof sql>) {
  const { withTenantTx } = await import("@/server/db/client");
  return withTenantTx(scope, (tx) => tx.execute(q)) as Promise<T>;
}

/** Resolves to the underlying PostgreSQL error message (drizzle wraps it as `cause`). */
export async function pgErrorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "OK";
  } catch (e) {
    const err = e as { cause?: { message?: string }; message: string };
    return err.cause?.message ?? err.message;
  }
}
