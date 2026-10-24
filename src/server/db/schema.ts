import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  EXCEPTION_TYPES,
  LEG_STATUSES,
  LOCATION_SOURCES,
  ORG_TYPES,
  PARTY_ROLES,
  SERVICE_TYPES,
  SHIPMENT_STATUSES,
} from "@/lib/domain";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });
/** Money in minor units. bigint in the DB, number in JS (safe up to 2^53). */
const minor = (name: string) => bigint(name, { mode: "number" });

export const orgTypeEnum = pgEnum("org_type", ORG_TYPES);
export const serviceTypeEnum = pgEnum("service_type", SERVICE_TYPES);
export const shipmentStatusEnum = pgEnum("shipment_status", SHIPMENT_STATUSES);
export const legStatusEnum = pgEnum("leg_status", LEG_STATUSES);
export const partyRoleEnum = pgEnum("party_role", PARTY_ROLES);
export const locationSourceEnum = pgEnum("location_source", LOCATION_SOURCES);
export const exceptionTypeEnum = pgEnum("exception_type", EXCEPTION_TYPES);
export const visibilityEnum = pgEnum("visibility", ["SHARED", "INTERNAL"]);
export const quoteStatusEnum = pgEnum("quote_status", ["SUBMITTED", "WITHDRAWN", "ACCEPTED", "DECLINED", "EXPIRED"]);
export const tenderStatusEnum = pgEnum("tender_status", ["OFFERED", "ACCEPTED", "DECLINED", "WITHDRAWN", "EXPIRED"]);
export const chargeStatusEnum = pgEnum("charge_status", ["ESTIMATED", "CONFIRMED", "VOID"]);
export const chargeKindEnum = pgEnum("charge_kind", ["RECEIVABLE", "PAYABLE"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "VOID"]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"]);
export const payableStatusEnum = pgEnum("payable_status", ["PENDING_POD", "APPROVED", "PAID", "VOID"]);
export const exceptionStatusEnum = pgEnum("exception_status", ["OPEN", "ACKNOWLEDGED", "RESOLVED"]);
export const complianceStatusEnum = pgEnum("compliance_status", ["UNVERIFIED", "PENDING_REVIEW", "VERIFIED", "EXPIRED", "REJECTED"]);
export const customsStatusEnum = pgEnum("customs_status", [
  "INTAKE",
  "DOCS_PENDING",
  "IN_REVIEW",
  "READY_TO_FILE",
  "SUBMITTED",
  "RELEASED",
  "HOLD",
  "CLOSED",
]);
export const reviewStatusEnum = pgEnum("review_status", ["PENDING_REVIEW", "APPROVED", "REJECTED"]);

/* ============================================================= Identity & organizations */

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  phone: text("phone"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
  disabledAt: ts("disabled_at"),
  lastLoginAt: ts("last_login_at"),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the user's cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activeOrgId: uuid("active_org_id"),
    expiresAt: ts("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: orgTypeEnum("type").notNull(),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull().default("ACTIVE"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  defaultCurrency: text("default_currency").notNull().default("USD"),
  documentRetentionDays: integer("document_retention_days").notNull().default(2555),
  city: text("city"),
  state: text("state"),
  phone: text("phone"),
  usdotNumber: text("usdot_number"),
  mcNumber: text("mc_number"),
  customsFilerCode: text("customs_filer_code"),
  isDemo: boolean("is_demo").notNull().default(false),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roles: text("roles").array().notNull(),
    grants: text("grants").array().notNull().default(sql`'{}'::text[]`),
    revocations: text("revocations").array().notNull().default(sql`'{}'::text[]`),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED"] }).notNull().default("ACTIVE"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId), index("memberships_user_idx").on(t.userId)],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    roles: text("roles").array().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_org_idx").on(t.orgId)],
);

export const providerProfiles = pgTable("provider_profiles", {
  orgId: uuid("org_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  serviceTypes: text("service_types").array().notNull().default(sql`'{}'::text[]`),
  equipmentTypes: text("equipment_types").array().notNull().default(sql`'{}'::text[]`),
  serviceStates: text("service_states").array().notNull().default(sql`'{}'::text[]`),
  acceptingLoads: boolean("accepting_loads").notNull().default(true),
  onTimePct: integer("on_time_pct"),
  completedLoads: integer("completed_loads").notNull().default(0),
  about: text("about"),
});

export const complianceRecords = pgTable(
  "compliance_records",
  {
    id: id(),
    subjectOrgId: uuid("subject_org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["OPERATING_AUTHORITY", "USDOT_REGISTRATION", "AUTO_LIABILITY_INSURANCE", "CARGO_INSURANCE", "CUSTOMS_LICENSE", "W9"],
    }).notNull(),
    identifier: text("identifier"),
    status: complianceStatusEnum("status").notNull().default("UNVERIFIED"),
    /** Where the verification evidence came from. Never claims an external check unless one actually ran. */
    source: text("source", { enum: ["SELF_REPORTED", "MANUAL_DOCUMENT_REVIEW", "DEMO_ADAPTER", "FMCSA_API"] })
      .notNull()
      .default("SELF_REPORTED"),
    coverageMinor: minor("coverage_minor"),
    currency: text("currency").default("USD"),
    effectiveDate: ts("effective_date"),
    expiresAt: ts("expires_at"),
    documentId: uuid("document_id"),
    verifiedAt: ts("verified_at"),
    verifiedByUserId: uuid("verified_by_user_id").references(() => users.id),
    verifiedByOrgId: uuid("verified_by_org_id").references(() => organizations.id),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("compliance_subject_idx").on(t.subjectOrgId)],
);

/* ============================================================= Fleet */

export const drivers = pgTable(
  "drivers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    phone: text("phone"),
    licenseState: text("license_state"),
    licenseExpiresAt: ts("license_expires_at"),
    status: text("status", { enum: ["AVAILABLE", "ON_TRIP", "OFF_DUTY", "INACTIVE"] }).notNull().default("AVAILABLE"),
    createdAt: createdAt(),
  },
  (t) => [index("drivers_org_idx").on(t.orgId)],
);

export const equipment = pgTable(
  "equipment",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    unitNumber: text("unit_number").notNull(),
    type: text("type").notNull(),
    vehicleCapacity: integer("vehicle_capacity"),
    maxWeightLb: integer("max_weight_lb"),
    plate: text("plate"),
    status: text("status", { enum: ["AVAILABLE", "IN_USE", "MAINTENANCE"] }).notNull().default("AVAILABLE"),
    availableFrom: ts("available_from"),
    currentCity: text("current_city"),
    currentState: text("current_state"),
    createdAt: createdAt(),
  },
  (t) => [index("equipment_org_idx").on(t.orgId)],
);

export const trips = pgTable(
  "trips",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    driverId: uuid("driver_id").references(() => drivers.id),
    equipmentId: uuid("equipment_id").references(() => equipment.id),
    capacity: integer("capacity").notNull(),
    plannedStart: ts("planned_start"),
    plannedEnd: ts("planned_end"),
    status: text("status", { enum: ["PLANNING", "DISPATCHED", "COMPLETED", "CANCELLED"] }).notNull().default("PLANNING"),
    createdAt: createdAt(),
  },
  (t) => [index("trips_org_idx").on(t.orgId)],
);

/* ============================================================= Shipments (digital twin) */

export const shipments = pgTable(
  "shipments",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    ownerOrgId: uuid("owner_org_id").notNull().references(() => organizations.id),
    createdBy: uuid("created_by").references(() => users.id),
    serviceType: serviceTypeEnum("service_type").notNull(),
    requiresCustoms: boolean("requires_customs").notNull().default(false),
    status: shipmentStatusEnum("status").notNull().default("DRAFT"),
    title: text("title").notNull(),
    customerReference: text("customer_reference"),
    commodity: text("commodity"),
    totalWeightLb: integer("total_weight_lb"),
    totalPieces: integer("total_pieces"),
    equipmentType: text("equipment_type"),
    accessorials: text("accessorials").array().notNull().default(sql`'{}'::text[]`),
    hazmat: boolean("hazmat").notNull().default(false),
    temperatureMinF: integer("temperature_min_f"),
    temperatureMaxF: integer("temperature_max_f"),
    specialInstructions: text("special_instructions"),
    currency: text("currency").notNull().default("USD"),
    /** MARKETPLACE requests are visible on provider load boards; INVITED only to invited providers. */
    quoteVisibility: text("quote_visibility", { enum: ["MARKETPLACE", "INVITED"] }).notNull().default("MARKETPLACE"),
    targetBudgetMinor: minor("target_budget_minor"),
    acceptedQuoteId: uuid("accepted_quote_id"),
    primaryProviderOrgId: uuid("primary_provider_org_id").references(() => organizations.id),
    // International / port details
    portOfEntry: text("port_of_entry"),
    vesselVoyage: text("vessel_voyage"),
    containerNumber: text("container_number"),
    billOfLadingNumber: text("bill_of_lading_number"),
    countryOfOrigin: text("country_of_origin"),
    portEta: ts("port_eta"),
    cancelledReason: text("cancelled_reason"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("shipments_owner_idx").on(t.ownerOrgId), index("shipments_status_idx").on(t.status)],
);

export const shipmentParties = pgTable(
  "shipment_parties",
  {
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    role: partyRoleEnum("role").notNull(),
    addedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.orgId, t.role] }), index("parties_org_idx").on(t.orgId)],
);

/** Providers explicitly invited to quote an INVITED request. */
export const quoteInvitations = pgTable(
  "quote_invitations",
  {
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    providerOrgId: uuid("provider_org_id").notNull().references(() => organizations.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.providerOrgId] })],
);

export const shipmentStops = pgTable(
  "shipment_stops",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind", { enum: ["PICKUP", "DELIVERY", "PORT", "RAIL_RAMP", "TERMINAL", "AUCTION", "DEALERSHIP"] }).notNull(),
    name: text("name").notNull(),
    address1: text("address1"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("US"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    timezone: text("timezone").notNull().default("America/Chicago"),
    windowStart: ts("window_start"),
    windowEnd: ts("window_end"),
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    reference: text("reference"),
    notes: text("notes"),
  },
  (t) => [index("stops_shipment_idx").on(t.shipmentId)],
);

export const shipmentItems = pgTable(
  "shipment_items",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull(),
    packaging: text("packaging").notNull().default("PALLET"),
    lengthIn: integer("length_in"),
    widthIn: integer("width_in"),
    heightIn: integer("height_in"),
    weightLb: integer("weight_lb").notNull(),
    freightClass: text("freight_class"),
    stackable: boolean("stackable").notNull().default(true),
    hazmat: boolean("hazmat").notNull().default(false),
  },
  (t) => [index("items_shipment_idx").on(t.shipmentId)],
);

export const shipmentLegs = pgTable(
  "shipment_legs",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    mode: text("mode", { enum: ["TRUCK", "RAIL", "DRAYAGE", "AUTO_CARRIER"] }).notNull().default("TRUCK"),
    fromStopId: uuid("from_stop_id").references(() => shipmentStops.id),
    toStopId: uuid("to_stop_id").references(() => shipmentStops.id),
    /** Organization that executes this leg (carrier / auto transporter). */
    executorOrgId: uuid("executor_org_id").references(() => organizations.id),
    /** Organization that manages the leg (the primary provider, e.g. a freight broker). */
    managerOrgId: uuid("manager_org_id").references(() => organizations.id),
    status: legStatusEnum("status").notNull().default("PLANNED"),
    driverId: uuid("driver_id").references(() => drivers.id),
    equipmentId: uuid("equipment_id").references(() => equipment.id),
    carrierRateMinor: minor("carrier_rate_minor"),
    currency: text("currency").notNull().default("USD"),
    plannedPickupAt: ts("planned_pickup_at"),
    plannedDeliveryAt: ts("planned_delivery_at"),
    actualPickupAt: ts("actual_pickup_at"),
    actualDeliveryAt: ts("actual_delivery_at"),
    etaAt: ts("eta_at"),
    createdAt: createdAt(),
  },
  (t) => [index("legs_shipment_idx").on(t.shipmentId), index("legs_executor_idx").on(t.executorOrgId)],
);

export const vehicles = pgTable(
  "shipment_vehicles",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    vin: text("vin").notNull(),
    year: integer("year").notNull(),
    make: text("make").notNull(),
    model: text("model").notNull(),
    color: text("color"),
    operable: boolean("operable").notNull().default(true),
    transportType: text("transport_type", { enum: ["OPEN", "ENCLOSED"] }).notNull().default("OPEN"),
    auctionReference: text("auction_reference"),
    dealershipReference: text("dealership_reference"),
    status: text("status", { enum: ["PENDING", "ASSIGNED", "PICKED_UP", "DELIVERED", "DAMAGE_REPORTED", "CANCELLED"] })
      .notNull()
      .default("PENDING"),
    tripId: uuid("trip_id").references(() => trips.id),
    pickedUpAt: ts("picked_up_at"),
    deliveredAt: ts("delivered_at"),
    notes: text("notes"),
  },
  (t) => [index("vehicles_shipment_idx").on(t.shipmentId), index("vehicles_trip_idx").on(t.tripId)],
);

export const inspections = pgTable(
  "inspections",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id").notNull().references(() => vehicles.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    kind: text("kind", { enum: ["PICKUP", "DELIVERY"] }).notNull(),
    performedBy: uuid("performed_by").references(() => users.id),
    performedAt: ts("performed_at").notNull().defaultNow(),
    odometer: integer("odometer"),
    notes: text("notes"),
    signerName: text("signer_name"),
    signatureDocumentId: uuid("signature_document_id"),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
  },
  (t) => [index("inspections_vehicle_idx").on(t.vehicleId)],
);

export const inspectionDamages = pgTable("inspection_damages", {
  id: id(),
  inspectionId: uuid("inspection_id").notNull().references(() => inspections.id, { onDelete: "cascade" }),
  photoDocumentId: uuid("photo_document_id"),
  area: text("area").notNull(),
  damageType: text("damage_type", { enum: ["SCRATCH", "DENT", "CHIP", "CRACK", "MISSING", "BROKEN", "OTHER"] }).notNull(),
  severity: text("severity", { enum: ["MINOR", "MODERATE", "MAJOR"] }).notNull().default("MINOR"),
  /** Annotation position on the photo, normalized 0–1. */
  x: doublePrecision("x"),
  y: doublePrecision("y"),
  note: text("note"),
});

export const tenders = pgTable(
  "tenders",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    legId: uuid("leg_id").notNull().references(() => shipmentLegs.id, { onDelete: "cascade" }),
    fromOrgId: uuid("from_org_id").notNull().references(() => organizations.id),
    toOrgId: uuid("to_org_id").notNull().references(() => organizations.id),
    rateMinor: minor("rate_minor").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: tenderStatusEnum("status").notNull().default("OFFERED"),
    notes: text("notes"),
    expiresAt: ts("expires_at"),
    createdBy: uuid("created_by").references(() => users.id),
    respondedBy: uuid("responded_by").references(() => users.id),
    respondedAt: ts("responded_at"),
    createdAt: createdAt(),
  },
  (t) => [index("tenders_to_idx").on(t.toOrgId), index("tenders_shipment_idx").on(t.shipmentId)],
);

export const shipmentStatusHistory = pgTable(
  "shipment_status_history",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    fromStatus: shipmentStatusEnum("from_status"),
    toStatus: shipmentStatusEnum("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorOrgId: uuid("actor_org_id").references(() => organizations.id),
    reason: text("reason"),
    changedAt: createdAt(),
  },
  (t) => [index("status_history_shipment_idx").on(t.shipmentId)],
);

/** Unified timeline. visibleToOrgId = null means all parties; otherwise internal to that org. */
export const shipmentEvents = pgTable(
  "shipment_events",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    legId: uuid("leg_id"),
    type: text("type").notNull(),
    title: text("title").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorOrgId: uuid("actor_org_id").references(() => organizations.id),
    visibleToOrgId: uuid("visible_to_org_id"),
    customerTracking: boolean("customer_tracking").notNull().default(false),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    recordedAt: createdAt(),
  },
  (t) => [index("events_shipment_idx").on(t.shipmentId, t.occurredAt)],
);

export const locationPings = pgTable(
  "location_pings",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    legId: uuid("leg_id"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: integer("accuracy_m"),
    source: locationSourceEnum("source").notNull(),
    label: text("label"),
    reportedBy: uuid("reported_by").references(() => users.id),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("pings_shipment_idx").on(t.shipmentId, t.recordedAt)],
);

export const shipmentExceptions = pgTable(
  "shipment_exceptions",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    legId: uuid("leg_id"),
    vehicleId: uuid("vehicle_id"),
    type: exceptionTypeEnum("type").notNull(),
    severity: text("severity", { enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"] }).notNull().default("MEDIUM"),
    status: exceptionStatusEnum("status").notNull().default("OPEN"),
    title: text("title").notNull(),
    description: text("description"),
    /** The evidence that triggered this exception (rule id, observed values, source records). */
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    customerVisible: boolean("customer_visible").notNull().default(false),
    openedByUserId: uuid("opened_by_user_id").references(() => users.id),
    openedByOrgId: uuid("opened_by_org_id").references(() => organizations.id),
    detectedBy: text("detected_by").notNull().default("USER"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
    resolution: text("resolution"),
    resolvedAt: ts("resolved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("exceptions_shipment_idx").on(t.shipmentId)],
);

/* ============================================================= Quotes & charges */

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    providerOrgId: uuid("provider_org_id").notNull().references(() => organizations.id),
    status: quoteStatusEnum("status").notNull().default("SUBMITTED"),
    currency: text("currency").notNull().default("USD"),
    totalMinor: minor("total_minor").notNull(),
    /** Internal cost estimate. Only visible to the provider organization (margin). */
    estimatedCostMinor: minor("estimated_cost_minor"),
    transitDays: integer("transit_days"),
    validUntil: ts("valid_until"),
    notes: text("notes"),
    submittedBy: uuid("submitted_by").references(() => users.id),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    acceptedAt: ts("accepted_at"),
    createdAt: createdAt(),
  },
  (t) => [index("quotes_shipment_idx").on(t.shipmentId), index("quotes_provider_idx").on(t.providerOrgId)],
);

export const quoteLines = pgTable("quote_lines", {
  id: id(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  description: text("description").notNull(),
  quantityMilli: integer("quantity_milli").notNull().default(1000),
  unitAmountMinor: minor("unit_amount_minor").notNull(),
  amountMinor: minor("amount_minor").notNull(),
});

export const charges = pgTable(
  "charges",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    kind: chargeKindEnum("kind").notNull(),
    /**
     * Every charge is "billerOrg charges billToOrg".
     * RECEIVABLE = customer-facing revenue (primary provider → customer).
     * PAYABLE    = execution cost (carrier → managing broker). Customers can never read PAYABLE rows.
     */
    billerOrgId: uuid("biller_org_id").notNull().references(() => organizations.id),
    billToOrgId: uuid("bill_to_org_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    description: text("description").notNull(),
    quantityMilli: integer("quantity_milli").notNull().default(1000),
    unitAmountMinor: minor("unit_amount_minor").notNull(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull().default("USD"),
    status: chargeStatusEnum("status").notNull().default("ESTIMATED"),
    source: text("source", { enum: ["QUOTE", "TENDER", "MANUAL"] }).notNull(),
    sourceId: uuid("source_id"),
    invoiceId: uuid("invoice_id"),
    createdBy: uuid("created_by").references(() => users.id),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    confirmedAt: ts("confirmed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("charges_shipment_idx").on(t.shipmentId)],
);

/* ============================================================= Finance */

export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull(),
    issuerOrgId: uuid("issuer_org_id").notNull().references(() => organizations.id),
    billToOrgId: uuid("bill_to_org_id").notNull().references(() => organizations.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id),
    status: invoiceStatusEnum("status").notNull().default("DRAFT"),
    currency: text("currency").notNull().default("USD"),
    subtotalMinor: minor("subtotal_minor").notNull().default(0),
    creditsMinor: minor("credits_minor").notNull().default(0),
    totalMinor: minor("total_minor").notNull().default(0),
    amountPaidMinor: minor("amount_paid_minor").notNull().default(0),
    issuedAt: ts("issued_at"),
    dueAt: ts("due_at"),
    memo: text("memo"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("invoices_issuer_number_uq").on(t.issuerOrgId, t.number), index("invoices_bill_to_idx").on(t.billToOrgId)],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  chargeId: uuid("charge_id"),
  code: text("code").notNull(),
  description: text("description").notNull(),
  quantityMilli: integer("quantity_milli").notNull(),
  unitAmountMinor: minor("unit_amount_minor").notNull(),
  amountMinor: minor("amount_minor").notNull(),
});

export const creditNotes = pgTable("credit_notes", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  amountMinor: minor("amount_minor").notNull(),
  currency: text("currency").notNull(),
  reason: text("reason").notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const payments = pgTable(
  "payments",
  {
    id: id(),
    invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
    payerOrgId: uuid("payer_org_id").notNull().references(() => organizations.id),
    payeeOrgId: uuid("payee_org_id").notNull().references(() => organizations.id),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    provider: text("provider").notNull(),
    providerPaymentId: text("provider_payment_id").notNull().unique(),
    status: paymentStatusEnum("status").notNull().default("PENDING"),
    isSandbox: boolean("is_sandbox").notNull().default(true),
    failureReason: text("failure_reason"),
    idempotencyKey: text("idempotency_key").unique(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)],
);

export const payables = pgTable(
  "payables",
  {
    id: id(),
    payerOrgId: uuid("payer_org_id").notNull().references(() => organizations.id),
    payeeOrgId: uuid("payee_org_id").notNull().references(() => organizations.id),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id),
    legId: uuid("leg_id"),
    tenderId: uuid("tender_id"),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: payableStatusEnum("status").notNull().default("PENDING_POD"),
    dueAt: ts("due_at"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: ts("approved_at"),
    paidAt: ts("paid_at"),
    reference: text("reference"),
    isDemo: boolean("is_demo").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("payables_payer_idx").on(t.payerOrgId), index("payables_payee_idx").on(t.payeeOrgId)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["RECEIVED", "PROCESSED", "FAILED", "IGNORED"] }).notNull().default("RECEIVED"),
    error: text("error"),
    receivedAt: createdAt(),
    processedAt: ts("processed_at"),
  },
  (t) => [uniqueIndex("webhook_provider_event_uq").on(t.provider, t.eventId)],
);

/* ============================================================= Documents */

export const documents = pgTable(
  "documents",
  {
    id: id(),
    ownerOrgId: uuid("owner_org_id").notNull().references(() => organizations.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "cascade" }),
    /** For organization-level documents (insurance, authority) that are not tied to a shipment. */
    subjectOrgId: uuid("subject_org_id").references(() => organizations.id),
    category: text("category").notNull(),
    title: text("title").notNull(),
    visibility: visibilityEnum("visibility").notNull().default("SHARED"),
    customerVisible: boolean("customer_visible").notNull().default(true),
    status: text("status", { enum: ["UPLOADED", "UNDER_REVIEW", "APPROVED", "REJECTED"] }).notNull().default("UPLOADED"),
    currentVersion: integer("current_version").notNull().default(1),
    retentionUntil: ts("retention_until"),
    deletedAt: ts("deleted_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("documents_shipment_idx").on(t.shipmentId), index("documents_owner_idx").on(t.ownerOrgId)],
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: id(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    uploadedAt: createdAt(),
    purgedAt: ts("purged_at"),
  },
  (t) => [uniqueIndex("doc_versions_uq").on(t.documentId, t.version)],
);

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  source: { page: number | null; snippet: string; start?: number; end?: number };
}

export interface ExtractedLineItem {
  partNumber: string | null;
  description: string;
  quantity: number | null;
  unitPrice: string | null;
  amount: string | null;
  countryOfOrigin: string | null;
  source: { page: number | null; snippet: string };
}

export const documentExtractions = pgTable(
  "document_extractions",
  {
    id: id(),
    documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    engine: text("engine").notNull(),
    status: text("status", { enum: ["PENDING", "COMPLETED", "FAILED"] }).notNull().default("PENDING"),
    fields: jsonb("fields").$type<ExtractedField[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("PENDING_REVIEW"),
    approvedFields: jsonb("approved_fields").$type<Record<string, string>>(),
    /** Invoice line items found in the document, each with its source citation. Drafts until approved. */
    lineItems: jsonb("line_items").$type<ExtractedLineItem[]>().notNull().default([]),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("extractions_document_idx").on(t.documentId)],
);

/** Documents a party has asked for on a shipment (drives "missing documents"). */
export const documentRequirements = pgTable(
  "document_requirements",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    requestedByOrgId: uuid("requested_by_org_id").notNull().references(() => organizations.id),
    category: text("category").notNull(),
    status: text("status", { enum: ["REQUESTED", "RECEIVED", "APPROVED", "WAIVED"] }).notNull().default("REQUESTED"),
    documentId: uuid("document_id"),
    dueAt: ts("due_at"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("doc_req_shipment_idx").on(t.shipmentId)],
);

/* ============================================================= Customs */

export const customsEntries = pgTable(
  "customs_entries",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    brokerOrgId: uuid("broker_org_id").notNull().references(() => organizations.id),
    clientId: uuid("client_id"),
    status: customsStatusEnum("status").notNull().default("INTAKE"),
    /** Entered by the broker; Vicora does not assign CBP entry numbers. */
    entryNumber: text("entry_number"),
    /** CBP entry type code as entered by the broker (e.g. "01"). */
    entryType: text("entry_type"),
    modeOfTransport: text("mode_of_transport", { enum: ["OCEAN", "AIR", "TRUCK", "RAIL"] }).notNull().default("OCEAN"),
    vesselDepartureAt: ts("vessel_departure_at"),
    releasedAt: ts("released_at"),
    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),
    portOfEntry: text("port_of_entry"),
    arrivalAt: ts("arrival_at"),
    importerName: text("importer_name"),
    /** Authoritative values: only written after a human approves them. */
    declaredValueMinor: minor("declared_value_minor"),
    currency: text("currency").default("USD"),
    countryOfOrigin: text("country_of_origin"),
    grossWeightKg: integer("gross_weight_kg"),
    brokerNotes: text("broker_notes"),
    filingAdapter: text("filing_adapter").notNull().default("NOT_CONNECTED"),
    filingReference: text("filing_reference"),
    filingSubmittedAt: ts("filing_submitted_at"),
    filingSubmittedBy: uuid("filing_submitted_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("customs_shipment_broker_uq").on(t.shipmentId, t.brokerOrgId)],
);

/** Classification / valuation lines are professional work product entered and approved by the broker. */
export const customsLines = pgTable("customs_lines", {
  id: id(),
  entryId: uuid("entry_id").notNull().references(() => customsEntries.id, { onDelete: "cascade" }),
  lineNumber: integer("line_number").notNull().default(0),
  partNumber: text("part_number"),
  description: text("description").notNull(),
  htsCode: text("hts_code"),
  /** The approved library item this classification came from, if any. */
  classificationItemId: uuid("classification_item_id"),
  /** Ad valorem rate entered by the broker, in basis points (e.g. 450 = 4.5%). Used only for estimates. */
  dutyRateBp: integer("duty_rate_bp"),
  quantity: integer("quantity"),
  valueMinor: minor("value_minor"),
  countryOfOrigin: text("country_of_origin"),
  brokerReviewed: boolean("broker_reviewed").notNull().default(false),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: ts("reviewed_at"),
  sourceExtractionId: uuid("source_extraction_id"),
});

/** A broker's importer client: power of attorney, bond and fee schedule, as recorded by the broker. */
export const customsClients = pgTable(
  "customs_clients",
  {
    id: id(),
    brokerOrgId: uuid("broker_org_id").notNull().references(() => organizations.id),
    /** The importer's Vicora organization, when the importer uses Vicora. */
    importerOrgId: uuid("importer_org_id").references(() => organizations.id),
    name: text("name").notNull(),
    /** Importer of record number exactly as provided (IRS EIN or CBP-assigned number). Displayed masked. */
    iorNumber: text("ior_number"),
    status: text("status", { enum: ["ONBOARDING", "ACTIVE", "INACTIVE"] }).notNull().default("ONBOARDING"),
    poaStatus: text("poa_status", { enum: ["NONE", "RECEIVED", "VERIFIED", "EXPIRED", "REVOKED"] }).notNull().default("NONE"),
    poaDocumentId: uuid("poa_document_id"),
    poaSignedAt: ts("poa_signed_at"),
    poaExpiresAt: ts("poa_expires_at"),
    poaVerifiedBy: uuid("poa_verified_by").references(() => users.id),
    poaVerifiedAt: ts("poa_verified_at"),
    bondType: text("bond_type", { enum: ["NONE", "SINGLE_TRANSACTION", "CONTINUOUS"] }).notNull().default("NONE"),
    bondNumber: text("bond_number"),
    suretyName: text("surety_name"),
    bondAmountMinor: minor("bond_amount_minor"),
    bondExpiresAt: ts("bond_expires_at"),
    bondSource: text("bond_source", { enum: ["SELF_REPORTED", "DOCUMENT_REVIEWED"] }).notNull().default("SELF_REPORTED"),
    currency: text("currency").notNull().default("USD"),
    entryFeeMinor: minor("entry_fee_minor"),
    perLineFeeMinor: minor("per_line_fee_minor"),
    isfFeeMinor: minor("isf_fee_minor"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("customs_clients_broker_idx").on(t.brokerOrgId), uniqueIndex("customs_clients_importer_uq").on(t.brokerOrgId, t.importerOrgId)],
);

/**
 * A client's product library. A classification becomes reusable only after a licensed broker approves it;
 * AI suggestions are stored separately and never written here without that approval.
 */
export const classificationItems = pgTable(
  "classification_items",
  {
    id: id(),
    brokerOrgId: uuid("broker_org_id").notNull().references(() => organizations.id),
    clientId: uuid("client_id").notNull().references(() => customsClients.id, { onDelete: "cascade" }),
    partNumber: text("part_number"),
    description: text("description").notNull(),
    htsCode: text("hts_code").notNull(),
    countryOfOrigin: text("country_of_origin"),
    status: text("status", { enum: ["DRAFT", "APPROVED", "RETIRED"] }).notNull().default("DRAFT"),
    rationale: text("rationale"),
    source: text("source", { enum: ["BROKER", "AI_SUGGESTION", "PRECEDENT"] }).notNull().default("BROKER"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: ts("approved_at"),
    timesUsed: integer("times_used").notNull().default(0),
    lastUsedAt: ts("last_used_at"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("classification_client_idx").on(t.clientId), index("classification_part_idx").on(t.brokerOrgId, t.partNumber)],
);

/** Deadline rules a brokerage configures. Vicora ships defaults labeled for verification; it does not maintain regulations. */
export const customsDeadlineRules = pgTable(
  "customs_deadline_rules",
  {
    id: id(),
    brokerOrgId: uuid("broker_org_id").notNull().references(() => organizations.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
    anchor: text("anchor", { enum: ["VESSEL_DEPARTURE", "ARRIVAL", "RELEASE", "ENTRY_OPENED"] }).notNull(),
    offsetDays: integer("offset_days").notNull().default(0),
    offsetHours: integer("offset_hours").notNull().default(0),
    businessDays: boolean("business_days").notNull().default(false),
    /** Applies only to these modes of transport (empty = all). */
    modes: jsonb("modes").$type<string[]>().notNull().default([]),
    reference: text("reference"),
    isDefaultTemplate: boolean("is_default_template").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("deadline_rules_org_key_uq").on(t.brokerOrgId, t.key)],
);

export const customsDeadlines = pgTable(
  "customs_deadlines",
  {
    id: id(),
    entryId: uuid("entry_id").notNull().references(() => customsEntries.id, { onDelete: "cascade" }),
    brokerOrgId: uuid("broker_org_id").notNull().references(() => organizations.id),
    ruleKey: text("rule_key").notNull(),
    label: text("label").notNull(),
    reference: text("reference"),
    dueAt: ts("due_at").notNull(),
    status: text("status", { enum: ["OPEN", "MET", "WAIVED"] }).notNull().default("OPEN"),
    completedBy: uuid("completed_by").references(() => users.id),
    completedAt: ts("completed_at"),
    note: text("note"),
  },
  (t) => [uniqueIndex("customs_deadlines_entry_rule_uq").on(t.entryId, t.ruleKey), index("customs_deadlines_due_idx").on(t.brokerOrgId, t.dueAt)],
);

export interface ReviewEvidence {
  kind: "document" | "line" | "extraction" | "client" | "deadline" | "library" | "entry";
  label: string;
  ref?: string;
  snippet?: string;
}
export interface ReviewFinding {
  id: string;
  code: string;
  severity: "BLOCKER" | "WARNING" | "INFO";
  title: string;
  detail: string;
  evidence: ReviewEvidence[];
  origin: "RULE" | "AI";
  resolution: { status: "ACKNOWLEDGED" | "RESOLVED"; by: string; at: string; note: string | null } | null;
}

/** Pre-filing review of an entry: rule checks plus optional AI observations, each with evidence. */
export const customsReviews = pgTable(
  "customs_reviews",
  {
    id: id(),
    entryId: uuid("entry_id").notNull().references(() => customsEntries.id, { onDelete: "cascade" }),
    brokerOrgId: uuid("broker_org_id").notNull().references(() => organizations.id),
    engine: text("engine").notNull(),
    score: integer("score").notNull(),
    findings: jsonb("findings").$type<ReviewFinding[]>().notNull().default([]),
    /** Fingerprint of the lines and documents reviewed; a later change makes the review stale. */
    inputHash: text("input_hash").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("customs_reviews_entry_idx").on(t.entryId)],
);

export interface QaCitation {
  id: string;
  label: string;
  snippet: string;
}

/** "Ask this file" questions and grounded answers, kept for audit. */
export const customsQuestions = pgTable(
  "customs_questions",
  {
    id: id(),
    entryId: uuid("entry_id").notNull().references(() => customsEntries.id, { onDelete: "cascade" }),
    brokerOrgId: uuid("broker_org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").references(() => users.id),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    citations: jsonb("citations").$type<QaCitation[]>().notNull().default([]),
    engine: text("engine").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("customs_questions_entry_idx").on(t.entryId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    shipmentId: uuid("shipment_id").references(() => shipments.id, { onDelete: "cascade" }),
    customsEntryId: uuid("customs_entry_id"),
    title: text("title").notNull(),
    description: text("description"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id),
    dueAt: ts("due_at"),
    priority: text("priority", { enum: ["LOW", "NORMAL", "HIGH"] }).notNull().default("NORMAL"),
    status: text("status", { enum: ["OPEN", "DONE"] }).notNull().default("OPEN"),
    createdBy: uuid("created_by").references(() => users.id),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("tasks_org_idx").on(t.orgId)],
);

/* ============================================================= Communications */

export const messages = pgTable(
  "messages",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    authorUserId: uuid("author_user_id").references(() => users.id),
    visibility: visibilityEnum("visibility").notNull().default("SHARED"),
    body: text("body").notNull(),
    aiDrafted: boolean("ai_drafted").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("messages_shipment_idx").on(t.shipmentId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    shipmentId: uuid("shipment_id"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    inApp: boolean("in_app").notNull().default(true),
    email: boolean("email").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType] })],
);

export const outboundMessages = pgTable("outbound_messages", {
  id: id(),
  channel: text("channel", { enum: ["EMAIL", "SMS"] }).notNull(),
  to: text("to").notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  provider: text("provider").notNull(),
  status: text("status", { enum: ["QUEUED", "DELIVERED_TO_OUTBOX", "NOT_CONNECTED", "FAILED"] }).notNull(),
  createdAt: createdAt(),
});

export const trackingLinks = pgTable(
  "tracking_links",
  {
    id: id(),
    shipmentId: uuid("shipment_id").notNull().references(() => shipments.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** Short non-secret prefix so users can tell links apart. */
    tokenPrefix: text("token_prefix").notNull(),
    label: text("label"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdByOrgId: uuid("created_by_org_id").notNull().references(() => organizations.id),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    lastAccessedAt: ts("last_accessed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("tracking_links_shipment_idx").on(t.shipmentId)],
);

export const savedViews = pgTable("saved_views", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<Record<string, string>>().notNull(),
  createdAt: createdAt(),
});

/* ============================================================= Platform */

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: uuid("org_id"),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt), index("audit_entity_idx").on(t.entityType, t.entityId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["QUEUED", "RUNNING", "DONE", "FAILED"] }).notNull().default("QUEUED"),
    runAt: ts("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: ts("locked_at"),
    dedupeKey: text("dedupe_key").unique(),
    createdAt: createdAt(),
  },
  (t) => [index("jobs_ready_idx").on(t.status, t.runAt)],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

export const counters = pgTable("counters", {
  key: text("key").primaryKey(),
  value: bigint("value", { mode: "number" }).notNull().default(0),
});
