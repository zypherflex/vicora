import type { Permission } from "@/lib/permissions";
import type { OrgType } from "@/lib/domain";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  show: (v: { perms: Set<Permission>; orgType: OrgType; roles: string[]; isPlatformAdmin: boolean }) => boolean;
}

export const NAV: NavItem[] = [
  { href: "/command", label: "Command center", icon: "LayoutDashboard", show: ({ roles }) => !roles.every((r) => r === "DRIVER") },
  { href: "/shipments", label: "Shipments", icon: "Package", show: ({ perms }) => perms.has("shipment.read") },
  { href: "/shipments/new", label: "Book a shipment", icon: "PlusCircle", show: ({ perms }) => perms.has("shipment.create") },
  { href: "/loadboard", label: "Load board", icon: "ListChecks", show: ({ perms }) => perms.has("loadboard.read") },
  { href: "/tenders", label: "Tenders", icon: "Handshake", show: ({ perms }) => perms.has("tender.create") || perms.has("tender.respond") },
  { href: "/fleet", label: "Fleet & trips", icon: "Truck", show: ({ perms }) => perms.has("fleet.read") },
  { href: "/driver", label: "Driver app", icon: "Smartphone", show: ({ perms, orgType }) => perms.has("milestone.record") && (orgType === "CARRIER" || orgType === "AUTO_TRANSPORT") },
  { href: "/customs", label: "Customs", icon: "Landmark", show: ({ perms, orgType }) => perms.has("customs.manage") && orgType === "CUSTOMS_BROKER" },
  { href: "/finance", label: "Finance", icon: "Receipt", show: ({ perms }) => perms.has("finance.read") },
  { href: "/providers", label: "Providers & compliance", icon: "ShieldCheck", show: ({ perms }) => perms.has("compliance.read") || perms.has("shipment.create") },
  { href: "/settings", label: "Team & settings", icon: "Settings", show: ({ perms }) => perms.has("team.read") },
  { href: "/audit", label: "Audit log", icon: "ScrollText", show: ({ perms }) => perms.has("audit.read") },
  { href: "/admin", label: "Platform admin", icon: "Building2", show: ({ isPlatformAdmin }) => isPlatformAdmin },
];
