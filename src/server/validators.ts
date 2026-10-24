import { z } from "zod";
import {
  ACCESSORIALS,
  CHARGE_CODES,
  DOCUMENT_CATEGORY_KEYS,
  EQUIPMENT_TYPES,
  EXCEPTION_TYPES,
  LOCATION_SOURCES,
  ORG_TYPES,
  SERVICE_TYPES,
  SHIPMENT_STATUSES,
  US_STATES,
} from "@/lib/domain";
import { CURRENCIES } from "@/lib/money";
import { PERMISSIONS, ROLES } from "@/lib/permissions";

const trimmed = (max = 200) => z.string().trim().min(1).max(max);
const optText = (max = 2000) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const isoDate = z.coerce.date();
const minorAmount = z.number().int().min(0).max(10_000_000_000);

export const registerSchema = z.object({
  name: trimmed(120),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(12, "Use at least 12 characters").max(200),
  organization: z.object({
    name: trimmed(160),
    type: z.enum(ORG_TYPES),
    city: optText(80),
    state: z.enum(US_STATES).optional().nullable(),
    usdotNumber: z.string().regex(/^\d{4,8}$/, "USDOT numbers are 4–8 digits").optional().nullable(),
    mcNumber: z.string().regex(/^(MC-?)?\d{4,8}$/i).optional().nullable(),
  }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roles: z.array(z.enum(ROLES)).min(1),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  name: trimmed(120).optional(),
  password: z.string().min(12).max(200).optional(),
});

export const updateMemberSchema = z.object({
  roles: z.array(z.enum(ROLES)).min(1).optional(),
  grants: z.array(z.enum(PERMISSIONS)).optional(),
  revocations: z.array(z.enum(PERMISSIONS)).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});

export const switchOrgSchema = z.object({ orgId: z.string().uuid() });

export const stopSchema = z.object({
  kind: z.enum(["PICKUP", "DELIVERY", "PORT", "RAIL_RAMP", "TERMINAL", "AUCTION", "DEALERSHIP"]),
  name: trimmed(160),
  address1: optText(200),
  city: trimmed(80),
  state: z.enum(US_STATES),
  postalCode: z
    .string()
    .regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP")
    .optional()
    .nullable(),
  windowStart: isoDate.optional().nullable(),
  windowEnd: isoDate.optional().nullable(),
  timezone: z.string().max(60).optional(),
  contactName: optText(120),
  contactPhone: optText(40),
  reference: optText(120),
  notes: optText(500),
});

export const itemSchema = z.object({
  description: trimmed(200),
  quantity: z.number().int().min(1).max(10000),
  packaging: z.enum(["PALLET", "CRATE", "BOX", "DRUM", "ROLL", "CONTAINER", "PIECE"]).default("PALLET"),
  lengthIn: z.number().int().min(1).max(1200).optional().nullable(),
  widthIn: z.number().int().min(1).max(120).optional().nullable(),
  heightIn: z.number().int().min(1).max(162).optional().nullable(),
  weightLb: z.number().int().min(1).max(200000),
  freightClass: z.enum(["50", "55", "60", "65", "70", "77.5", "85", "92.5", "100", "110", "125", "150", "175", "200", "250", "300", "400", "500"]).optional().nullable(),
  stackable: z.boolean().default(true),
  hazmat: z.boolean().default(false),
});

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
export const vehicleSchema = z.object({
  vin: z.string().trim().toUpperCase().regex(VIN, "VIN must be 17 characters (no I, O or Q)"),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 2),
  make: trimmed(60),
  model: trimmed(60),
  color: optText(40),
  operable: z.boolean(),
  transportType: z.enum(["OPEN", "ENCLOSED"]),
  auctionReference: optText(80),
  dealershipReference: optText(80),
  notes: optText(500),
});

export const createShipmentSchema = z
  .object({
    serviceType: z.enum(SERVICE_TYPES),
    title: trimmed(160),
    customerReference: optText(80),
    requiresCustoms: z.boolean().default(false),
    commodity: optText(200),
    equipmentType: z.enum(EQUIPMENT_TYPES).optional().nullable(),
    accessorials: z.array(z.enum(ACCESSORIALS)).default([]),
    hazmat: z.boolean().default(false),
    temperatureMinF: z.number().int().min(-40).max(120).optional().nullable(),
    temperatureMaxF: z.number().int().min(-40).max(120).optional().nullable(),
    specialInstructions: optText(2000),
    currency: z.enum(CURRENCIES).default("USD"),
    targetBudgetMinor: minorAmount.optional().nullable(),
    quoteVisibility: z.enum(["MARKETPLACE", "INVITED"]).default("MARKETPLACE"),
    invitedProviderOrgIds: z.array(z.string().uuid()).max(20).default([]),
    stops: z.array(stopSchema).min(2).max(10),
    items: z.array(itemSchema).max(100).default([]),
    vehicles: z.array(vehicleSchema).max(12).default([]),
    international: z
      .object({
        portOfEntry: optText(120),
        vesselVoyage: optText(120),
        containerNumber: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{4}\d{7}$/, "Container numbers are 4 letters + 7 digits")
          .optional()
          .nullable(),
        billOfLadingNumber: optText(60),
        countryOfOrigin: z.string().length(2).toUpperCase().optional().nullable(),
        portEta: isoDate.optional().nullable(),
      })
      .optional(),
    submit: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.serviceType === "AUTO_TRANSPORT" && v.vehicles.length === 0)
      ctx.addIssue({ code: "custom", path: ["vehicles"], message: "Add at least one vehicle" });
    if (v.serviceType !== "AUTO_TRANSPORT" && v.items.length === 0)
      ctx.addIssue({ code: "custom", path: ["items"], message: "Add at least one cargo line" });
    if (!v.stops.some((s) => ["PICKUP", "PORT", "AUCTION", "DEALERSHIP", "RAIL_RAMP", "TERMINAL"].includes(s.kind)))
      ctx.addIssue({ code: "custom", path: ["stops"], message: "Add an origin stop" });
    if (v.stops[v.stops.length - 1]?.kind !== "DELIVERY" && v.stops[v.stops.length - 1]?.kind !== "DEALERSHIP")
      ctx.addIssue({ code: "custom", path: ["stops"], message: "The final stop must be a delivery" });
    for (const [i, s] of v.stops.entries()) {
      if (s.windowStart && s.windowEnd && s.windowEnd < s.windowStart)
        ctx.addIssue({ code: "custom", path: ["stops", i, "windowEnd"], message: "Window end must be after start" });
    }
    if (v.temperatureMinF != null && v.temperatureMaxF != null && v.temperatureMinF > v.temperatureMaxF)
      ctx.addIssue({ code: "custom", path: ["temperatureMaxF"], message: "Max temperature must be ≥ min" });
    const vins = v.vehicles.map((x) => x.vin);
    if (new Set(vins).size !== vins.length) ctx.addIssue({ code: "custom", path: ["vehicles"], message: "Duplicate VIN" });
  });
export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

export const shipmentListQuery = z.object({
  q: z.string().max(100).optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  serviceType: z.enum(SERVICE_TYPES).optional(),
  attention: z.enum(["1"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const transitionSchema = z.object({
  to: z.enum(SHIPMENT_STATUSES),
  reason: optText(500),
});

export const quoteLineSchema = z.object({
  code: z.enum(CHARGE_CODES),
  description: trimmed(160),
  quantityMilli: z.number().int().min(1).max(10_000_000).default(1000),
  unitAmountMinor: z.number().int().min(-1_000_000_000).max(1_000_000_000),
});

export const submitQuoteSchema = z.object({
  currency: z.enum(CURRENCIES).default("USD"),
  lines: z.array(quoteLineSchema).min(1).max(30),
  estimatedCostMinor: minorAmount.optional().nullable(),
  transitDays: z.number().int().min(0).max(90).optional().nullable(),
  validUntil: isoDate.optional().nullable(),
  notes: optText(1000),
});

export const tenderSchema = z.object({
  legId: z.string().uuid(),
  carrierOrgId: z.string().uuid(),
  rateMinor: minorAmount,
  currency: z.enum(CURRENCIES).default("USD"),
  notes: optText(1000),
  expiresInHours: z.number().int().min(1).max(168).default(24),
});

export const tenderResponseSchema = z.object({ accept: z.boolean(), notes: optText(500) });

export const dispatchSchema = z.object({
  legId: z.string().uuid(),
  driverId: z.string().uuid(),
  equipmentId: z.string().uuid(),
  plannedPickupAt: isoDate.optional().nullable(),
  plannedDeliveryAt: isoDate.optional().nullable(),
});

export const legMilestoneSchema = z.object({
  status: z.enum(["AT_PICKUP", "PICKED_UP", "IN_TRANSIT", "AT_DELIVERY", "DELIVERED"]),
  occurredAt: isoDate.optional(),
  note: optText(500),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  locationSource: z.enum(LOCATION_SOURCES).optional(),
  podSignerName: optText(120),
  podDocumentId: z.string().uuid().optional().nullable(),
  vehicleIds: z.array(z.string().uuid()).optional(),
});

export const locationSchema = z.object({
  legId: z.string().uuid().optional().nullable(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().int().min(0).max(100000).optional().nullable(),
  source: z.enum(["LIVE_GPS", "MANUAL"]),
  label: optText(120),
});

export const exceptionSchema = z.object({
  type: z.enum(EXCEPTION_TYPES),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  title: trimmed(160),
  description: optText(2000),
  legId: z.string().uuid().optional().nullable(),
  vehicleId: z.string().uuid().optional().nullable(),
  customerVisible: z.boolean().default(false),
});

export const resolveExceptionSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
  resolution: optText(2000),
});

export const messageSchema = z.object({
  body: trimmed(5000),
  visibility: z.enum(["SHARED", "INTERNAL"]).default("SHARED"),
  aiDrafted: z.boolean().default(false),
});

export const trackingLinkSchema = z.object({
  label: optText(80),
  expiresInDays: z.number().int().min(1).max(90).default(14),
});

export const documentMetaSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORY_KEYS),
  title: optText(160),
  visibility: z.enum(["SHARED", "INTERNAL"]).default("SHARED"),
  customerVisible: z.coerce.boolean().default(true),
  documentId: z.string().uuid().optional().nullable(),
});

export const documentRequirementSchema = z.object({
  category: z.enum(DOCUMENT_CATEGORY_KEYS),
  dueAt: isoDate.optional().nullable(),
  note: optText(500),
});

export const chargeSchema = z.object({
  code: z.enum(CHARGE_CODES),
  description: trimmed(160),
  quantityMilli: z.number().int().min(1).max(10_000_000).default(1000),
  unitAmountMinor: z.number().int().min(-1_000_000_000).max(1_000_000_000),
});

export const createInvoiceSchema = z.object({
  shipmentId: z.string().uuid(),
  dueInDays: z.number().int().min(0).max(120).default(30),
  memo: optText(1000),
});

export const creditNoteSchema = z.object({ amountMinor: z.number().int().min(1), reason: trimmed(500) });

export const payInvoiceSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  /** Sandbox only: pick the simulated outcome. */
  sandboxOutcome: z.enum(["succeed", "decline"]).default("succeed"),
});

export const savedViewSchema = z.object({
  name: trimmed(60),
  filters: z.record(z.string(), z.string().max(100)),
});

export const driverSchema = z.object({
  name: trimmed(120),
  phone: optText(40),
  licenseState: z.enum(US_STATES).optional().nullable(),
  licenseExpiresAt: isoDate.optional().nullable(),
  email: z.string().trim().toLowerCase().email().optional().nullable(),
});

export const equipmentSchema = z.object({
  unitNumber: trimmed(40),
  type: z.enum(EQUIPMENT_TYPES),
  vehicleCapacity: z.number().int().min(1).max(12).optional().nullable(),
  maxWeightLb: z.number().int().min(1).max(200000).optional().nullable(),
  plate: optText(20),
  status: z.enum(["AVAILABLE", "IN_USE", "MAINTENANCE"]).default("AVAILABLE"),
  currentCity: optText(80),
  currentState: z.enum(US_STATES).optional().nullable(),
});

export const tripSchema = z.object({
  name: trimmed(120),
  driverId: z.string().uuid().optional().nullable(),
  equipmentId: z.string().uuid(),
  plannedStart: isoDate.optional().nullable(),
  vehicleIds: z.array(z.string().uuid()).default([]),
});

export const inspectionSchema = z.object({
  vehicleId: z.string().uuid(),
  kind: z.enum(["PICKUP", "DELIVERY"]),
  odometer: z.number().int().min(0).max(2_000_000).optional().nullable(),
  notes: optText(2000),
  signerName: optText(120),
  signatureDocumentId: z.string().uuid().optional().nullable(),
  photoDocumentIds: z.array(z.string().uuid()).max(40).default([]),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  damages: z
    .array(
      z.object({
        area: trimmed(60),
        damageType: z.enum(["SCRATCH", "DENT", "CHIP", "CRACK", "MISSING", "BROKEN", "OTHER"]),
        severity: z.enum(["MINOR", "MODERATE", "MAJOR"]).default("MINOR"),
        photoDocumentId: z.string().uuid().optional().nullable(),
        x: z.number().min(0).max(1).optional().nullable(),
        y: z.number().min(0).max(1).optional().nullable(),
        note: optText(500),
      }),
    )
    .max(50)
    .default([]),
});

export const complianceRecordSchema = z.object({
  type: z.enum(["OPERATING_AUTHORITY", "USDOT_REGISTRATION", "AUTO_LIABILITY_INSURANCE", "CARGO_INSURANCE", "CUSTOMS_LICENSE", "W9"]),
  identifier: optText(80),
  coverageMinor: minorAmount.optional().nullable(),
  effectiveDate: isoDate.optional().nullable(),
  expiresAt: isoDate.optional().nullable(),
  documentId: z.string().uuid().optional().nullable(),
  notes: optText(1000),
});

export const verifyComplianceSchema = z.object({
  result: z.enum(["VERIFIED", "REJECTED"]),
  method: z.enum(["MANUAL_DOCUMENT_REVIEW", "DEMO_ADAPTER"]),
  notes: optText(1000),
});

export const customsEntrySchema = z.object({
  portOfEntry: optText(120),
  arrivalAt: isoDate.optional().nullable(),
  importerName: optText(160),
  assignedToUserId: z.string().uuid().optional().nullable(),
  brokerNotes: optText(4000),
});

export const customsStatusSchema = z.object({
  status: z.enum(["INTAKE", "DOCS_PENDING", "IN_REVIEW", "READY_TO_FILE", "RELEASED", "HOLD", "CLOSED"]),
});

export const customsLineSchema = z.object({
  description: trimmed(300),
  htsCode: z
    .string()
    .regex(/^\d{4}(\.\d{2}){0,3}$/, "Format as 0000.00.00.00")
    .optional()
    .nullable(),
  quantity: z.number().int().min(0).optional().nullable(),
  valueMinor: minorAmount.optional().nullable(),
  countryOfOrigin: z.string().length(2).toUpperCase().optional().nullable(),
  brokerReviewed: z.boolean().default(false),
});

export const extractionReviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  /** Human-confirmed values. Keys must come from the extraction. */
  fields: z.record(z.string(), z.string().max(500)).default({}),
  applyToEntry: z.boolean().default(false),
});

export const taskSchema = z.object({
  title: trimmed(200),
  description: optText(2000),
  shipmentId: z.string().uuid().optional().nullable(),
  customsEntryId: z.string().uuid().optional().nullable(),
  assigneeUserId: z.string().uuid().optional().nullable(),
  dueAt: isoDate.optional().nullable(),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]).default("NORMAL"),
});

export const notificationPrefSchema = z.object({
  preferences: z.array(z.object({ eventType: z.string().max(60), inApp: z.boolean(), email: z.boolean() })).max(50),
});

export const orgSettingsSchema = z.object({
  name: trimmed(160).optional(),
  timezone: z.string().max(60).optional(),
  documentRetentionDays: z.number().int().min(30).max(3650).optional(),
  serviceStates: z.array(z.enum(US_STATES)).optional(),
  equipmentTypes: z.array(z.enum(EQUIPMENT_TYPES)).optional(),
  serviceTypes: z.array(z.enum(SERVICE_TYPES)).optional(),
  acceptingLoads: z.boolean().optional(),
});

export const copilotSchema = z.object({
  task: z.enum(["summarize", "draft_update", "next_steps"]),
  audience: z.enum(["customer", "internal"]).default("customer"),
});
