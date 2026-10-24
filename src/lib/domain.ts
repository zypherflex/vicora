/** Shared domain vocabulary used by both server and UI. */

export const ORG_TYPES = ["SHIPPER", "CUSTOMS_BROKER", "FREIGHT_BROKER", "CARRIER", "AUTO_TRANSPORT"] as const;
export type OrgType = (typeof ORG_TYPES)[number];
export const ORG_TYPE_LABEL: Record<OrgType, string> = {
  SHIPPER: "Importer / exporter / shipper",
  CUSTOMS_BROKER: "Licensed customs broker",
  FREIGHT_BROKER: "Freight broker",
  CARRIER: "Motor carrier",
  AUTO_TRANSPORT: "Auto transport company",
};
export const PROVIDER_ORG_TYPES: OrgType[] = ["FREIGHT_BROKER", "CARRIER", "AUTO_TRANSPORT"];

export const SERVICE_TYPES = ["FTL", "LTL", "AUTO_TRANSPORT", "INTERMODAL", "PORT_TO_DOOR"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_TYPE_LABEL: Record<ServiceType, string> = {
  FTL: "Full truckload",
  LTL: "Less-than-truckload",
  AUTO_TRANSPORT: "Vehicle transport",
  INTERMODAL: "Intermodal",
  PORT_TO_DOOR: "Port-to-door",
};

export const EQUIPMENT_TYPES = [
  "DRY_VAN",
  "REEFER",
  "FLATBED",
  "STEP_DECK",
  "BOX_TRUCK",
  "CONTAINER_CHASSIS_20",
  "CONTAINER_CHASSIS_40",
  "CAR_CARRIER_OPEN",
  "CAR_CARRIER_ENCLOSED",
  "HOTSHOT",
] as const;
export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];
export const EQUIPMENT_LABEL: Record<EquipmentType, string> = {
  DRY_VAN: "53' dry van",
  REEFER: "53' reefer",
  FLATBED: "48' flatbed",
  STEP_DECK: "Step deck",
  BOX_TRUCK: "26' box truck",
  CONTAINER_CHASSIS_20: "20' container chassis",
  CONTAINER_CHASSIS_40: "40' container chassis",
  CAR_CARRIER_OPEN: "Open car carrier",
  CAR_CARRIER_ENCLOSED: "Enclosed car carrier",
  HOTSHOT: "Hotshot / wedge",
};

export const ACCESSORIALS = [
  "LIFTGATE_PICKUP",
  "LIFTGATE_DELIVERY",
  "INSIDE_DELIVERY",
  "RESIDENTIAL",
  "APPOINTMENT",
  "HAZMAT",
  "TEAM_DRIVERS",
  "TARP",
  "DRAYAGE",
  "CHASSIS_SPLIT",
  "TOP_LOAD",
] as const;
export type Accessorial = (typeof ACCESSORIALS)[number];
export const ACCESSORIAL_LABEL: Record<Accessorial, string> = {
  LIFTGATE_PICKUP: "Liftgate at pickup",
  LIFTGATE_DELIVERY: "Liftgate at delivery",
  INSIDE_DELIVERY: "Inside delivery",
  RESIDENTIAL: "Residential location",
  APPOINTMENT: "Appointment required",
  HAZMAT: "Hazardous materials",
  TEAM_DRIVERS: "Team drivers",
  TARP: "Tarping",
  DRAYAGE: "Port drayage",
  CHASSIS_SPLIT: "Chassis split",
  TOP_LOAD: "Top-load (vehicles)",
};

/* ---------------------------------------------------------------- Shipment status model */

export const SHIPMENT_STATUSES = [
  "DRAFT",
  "QUOTE_REQUESTED",
  "BOOKED",
  "ASSIGNED",
  "DISPATCHED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  DRAFT: "Draft",
  QUOTE_REQUESTED: "Quote requested",
  BOOKED: "Booked",
  ASSIGNED: "Carrier assigned",
  DISPATCHED: "Dispatched",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Who may drive a transition. "system" transitions are performed by services as side effects. */
export type TransitionActor = "CUSTOMER" | "PROVIDER" | "EXECUTOR" | "SYSTEM";

export const SHIPMENT_TRANSITIONS: Record<ShipmentStatus, Partial<Record<ShipmentStatus, TransitionActor[]>>> = {
  DRAFT: { QUOTE_REQUESTED: ["CUSTOMER"], CANCELLED: ["CUSTOMER"] },
  QUOTE_REQUESTED: { BOOKED: ["SYSTEM"], DRAFT: ["CUSTOMER"], CANCELLED: ["CUSTOMER"] },
  BOOKED: { ASSIGNED: ["SYSTEM", "PROVIDER"], CANCELLED: ["CUSTOMER", "PROVIDER"] },
  ASSIGNED: { DISPATCHED: ["SYSTEM", "EXECUTOR"], BOOKED: ["PROVIDER"], CANCELLED: ["CUSTOMER", "PROVIDER"] },
  DISPATCHED: { PICKED_UP: ["SYSTEM", "EXECUTOR"], ASSIGNED: ["EXECUTOR", "PROVIDER"] },
  PICKED_UP: { IN_TRANSIT: ["SYSTEM", "EXECUTOR"], DELIVERED: ["SYSTEM", "EXECUTOR"] },
  IN_TRANSIT: { DELIVERED: ["SYSTEM", "EXECUTOR"] },
  DELIVERED: { COMPLETED: ["SYSTEM", "PROVIDER"] },
  COMPLETED: {},
  CANCELLED: {},
};

export function canTransition(from: ShipmentStatus, to: ShipmentStatus, actor?: TransitionActor): boolean {
  const allowed = SHIPMENT_TRANSITIONS[from]?.[to];
  if (!allowed) return false;
  return actor ? allowed.includes(actor) : true;
}

export const ACTIVE_STATUSES: ShipmentStatus[] = ["BOOKED", "ASSIGNED", "DISPATCHED", "PICKED_UP", "IN_TRANSIT"];

/* ---------------------------------------------------------------- Legs */

export const LEG_STATUSES = [
  "PLANNED",
  "TENDERED",
  "ACCEPTED",
  "DISPATCHED",
  "AT_PICKUP",
  "PICKED_UP",
  "IN_TRANSIT",
  "AT_DELIVERY",
  "DELIVERED",
  "CANCELLED",
] as const;
export type LegStatus = (typeof LEG_STATUSES)[number];
export const LEG_TRANSITIONS: Record<LegStatus, LegStatus[]> = {
  PLANNED: ["TENDERED", "ACCEPTED", "CANCELLED"],
  TENDERED: ["ACCEPTED", "PLANNED", "CANCELLED"],
  ACCEPTED: ["DISPATCHED", "PLANNED", "CANCELLED"],
  DISPATCHED: ["AT_PICKUP", "PICKED_UP", "ACCEPTED"],
  AT_PICKUP: ["PICKED_UP"],
  PICKED_UP: ["IN_TRANSIT", "AT_DELIVERY", "DELIVERED"],
  IN_TRANSIT: ["AT_DELIVERY", "DELIVERED"],
  AT_DELIVERY: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};
export const LEG_STATUS_LABEL: Record<LegStatus, string> = {
  PLANNED: "Planned",
  TENDERED: "Tendered",
  ACCEPTED: "Accepted",
  DISPATCHED: "Dispatched",
  AT_PICKUP: "Arrived at pickup",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  AT_DELIVERY: "Arrived at delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
};

export const LOCATION_SOURCES = ["LIVE_GPS", "MANUAL", "DEMO"] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];
export const LOCATION_SOURCE_LABEL: Record<LocationSource, string> = {
  LIVE_GPS: "Live GPS (device)",
  MANUAL: "Manually reported",
  DEMO: "Demonstration data",
};

export const PARTY_ROLES = ["CUSTOMER", "PRIMARY_PROVIDER", "CARRIER", "CUSTOMS_BROKER"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const EXCEPTION_TYPES = [
  "DELAY",
  "DAMAGE",
  "MISSING_DOCUMENT",
  "CUSTOMS_HOLD",
  "EQUIPMENT_FAILURE",
  "ACCESS_ISSUE",
  "STALE_TRACKING",
  "OTHER",
] as const;
export type ExceptionType = (typeof EXCEPTION_TYPES)[number];

export const DOCUMENT_CATEGORIES = [
  { key: "COMMERCIAL_INVOICE", label: "Commercial invoice", customs: true },
  { key: "PACKING_LIST", label: "Packing list", customs: true },
  { key: "BILL_OF_LADING", label: "Bill of lading", customs: true },
  { key: "AIR_WAYBILL", label: "Air waybill", customs: true },
  { key: "ARRIVAL_NOTICE", label: "Arrival notice", customs: true },
  { key: "POWER_OF_ATTORNEY", label: "Power of attorney", customs: true },
  { key: "CERTIFICATE_OF_ORIGIN", label: "Certificate of origin", customs: true },
  { key: "RATE_CONFIRMATION", label: "Rate confirmation", customs: false },
  { key: "PROOF_OF_DELIVERY", label: "Proof of delivery", customs: false },
  { key: "VEHICLE_PHOTO", label: "Vehicle photo", customs: false },
  { key: "VEHICLE_TITLE", label: "Vehicle title / release", customs: false },
  { key: "GATE_PASS", label: "Gate pass / release", customs: false },
  { key: "SIGNATURE", label: "Signature", customs: false },
  { key: "INSURANCE_CERTIFICATE", label: "Certificate of insurance", customs: false },
  { key: "OPERATING_AUTHORITY", label: "Operating authority", customs: false },
  { key: "OTHER", label: "Other", customs: false },
] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]["key"];
export const DOCUMENT_CATEGORY_KEYS = DOCUMENT_CATEGORIES.map((c) => c.key) as unknown as [DocumentCategory, ...DocumentCategory[]];
export function categoryLabel(key: string): string {
  return DOCUMENT_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export const CHARGE_CODES = [
  "LINEHAUL",
  "FUEL_SURCHARGE",
  "ACCESSORIAL",
  "DETENTION",
  "LUMPER",
  "DRAYAGE",
  "CHASSIS",
  "CUSTOMS_BROKERAGE",
  "VEHICLE_TRANSPORT",
  "ENCLOSED_PREMIUM",
  "INOPERABLE_FEE",
  "OTHER",
] as const;
export type ChargeCode = (typeof CHARGE_CODES)[number];

export const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
] as const;
