// Generates drizzle/0001_rls.sql. Kept as a script so the policy set is reviewable in one place.
import { writeFileSync } from "node:fs";
const out = [];
const s = (x) => out.push(x.trim());

s(`
CREATE SEQUENCE IF NOT EXISTS shipment_ref_seq START 1001;
`);
s(`
CREATE OR REPLACE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;
`);
s(`
CREATE OR REPLACE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
`);
s(`
CREATE OR REPLACE FUNCTION app_org_type() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_type', true), '')
$$;
`);
// SECURITY DEFINER helpers run as the owner so they can look across tables without recursive RLS.
s(`
CREATE OR REPLACE FUNCTION app_is_party(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_org() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM shipments s WHERE s.id = sid AND s.owner_org_id = app_org())
    OR EXISTS (SELECT 1 FROM shipment_parties p WHERE p.shipment_id = sid AND p.org_id = app_org())
  )
$$;
`);
s(`
CREATE OR REPLACE FUNCTION app_is_customer(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM shipments s WHERE s.id = sid AND s.owner_org_id = app_org())
$$;
`);
// Limited preview: open quote requests for providers, or an outstanding tender to the current org.
s(`
CREATE OR REPLACE FUNCTION app_can_preview(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_org() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM shipments s
      WHERE s.id = sid AND s.status = 'QUOTE_REQUESTED' AND (
        (s.quote_visibility = 'MARKETPLACE' AND app_org_type() IN ('FREIGHT_BROKER','CARRIER','AUTO_TRANSPORT'))
        OR EXISTS (SELECT 1 FROM quote_invitations qi WHERE qi.shipment_id = sid AND qi.provider_org_id = app_org())
      )
    )
    OR EXISTS (SELECT 1 FROM tenders t WHERE t.shipment_id = sid AND t.to_org_id = app_org() AND t.status = 'OFFERED')
  )
$$;
`);

// Aggregate capacity signal for provider matching: counts only, never unit-level fleet data.
s(`
CREATE OR REPLACE FUNCTION app_equipment_availability()
RETURNS TABLE (org_id uuid, type text, available integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.org_id, e.type, count(*)::int FROM equipment e
  WHERE e.status = 'AVAILABLE' AND (e.available_from IS NULL OR e.available_from <= now() + interval '3 days')
  GROUP BY e.org_id, e.type
$$;
`);

const tenant = [];
function table(name, policies) {
  tenant.push(name);
  s(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`);
  for (const [cmd, using, check] of policies) {
    const pname = `${name}_${cmd.toLowerCase()}`;
    let p = `CREATE POLICY ${pname} ON "${name}" FOR ${cmd} TO vicora_app`;
    if (using) p += ` USING (${using})`;
    if (check) p += ` WITHCHECK`.replace("WITHCHECK", ` WITH CHECK (${check})`);
    s(p + ";");
  }
}
const ALL = (cond) => [
  ["SELECT", cond],
  ["INSERT", null, cond],
  ["UPDATE", cond, cond],
  ["DELETE", cond],
];
const viaShipment = "app_is_party(shipment_id)";
const viewShipment = "app_is_party(shipment_id) OR app_can_preview(shipment_id)";

table("organizations", [["SELECT", "true"], ["UPDATE", "id = app_org()", "id = app_org()"]]);
table("memberships", [["SELECT", "org_id = app_org() OR user_id = app_user()"], ["INSERT", null, "org_id = app_org()"], ["UPDATE", "org_id = app_org()", "org_id = app_org()"], ["DELETE", "org_id = app_org()"]]);
table("invitations", ALL("org_id = app_org()"));
table("provider_profiles", [["SELECT", "true"], ["INSERT", null, "org_id = app_org()"], ["UPDATE", "org_id = app_org()", "org_id = app_org()"]]);
table("compliance_records", [
  ["SELECT", "true"],
  ["INSERT", null, "subject_org_id = app_org()"],
  // Subjects edit their own records; freight brokers' compliance staff may record a verification review.
  ["UPDATE", "subject_org_id = app_org() OR app_org_type() = 'FREIGHT_BROKER'", "true"],
]);
table("drivers", [
  ["SELECT", "org_id = app_org() OR EXISTS (SELECT 1 FROM shipment_legs l WHERE l.driver_id = drivers.id)"],
  ["INSERT", null, "org_id = app_org()"],
  ["UPDATE", "org_id = app_org()", "org_id = app_org()"],
  ["DELETE", "org_id = app_org()"],
]);
table("equipment", [
  ["SELECT", "org_id = app_org() OR EXISTS (SELECT 1 FROM shipment_legs l WHERE l.equipment_id = equipment.id)"],
  ["INSERT", null, "org_id = app_org()"],
  ["UPDATE", "org_id = app_org()", "org_id = app_org()"],
  ["DELETE", "org_id = app_org()"],
]);
table("trips", ALL("org_id = app_org()"));
table("shipments", [
  ["SELECT", "owner_org_id = app_org() OR app_is_party(id) OR app_can_preview(id)"],
  ["INSERT", null, "owner_org_id = app_org()"],
  ["UPDATE", "app_is_party(id)", "true"],
]);
table("shipment_parties", [["SELECT", viewShipment + " OR org_id = app_org()"], ["INSERT", null, "true"], ["DELETE", "app_is_party(shipment_id)"]]);
table("quote_invitations", [
  ["SELECT", "app_is_customer(shipment_id) OR provider_org_id = app_org()"],
  ["INSERT", null, "app_is_customer(shipment_id)"],
  ["DELETE", "app_is_customer(shipment_id)"],
]);
for (const t of ["shipment_stops", "shipment_items", "shipment_vehicles"]) {
  table(t, [["SELECT", viewShipment], ["INSERT", null, viaShipment], ["UPDATE", viaShipment, viaShipment], ["DELETE", viaShipment]]);
}
table("shipment_legs", [["SELECT", viewShipment], ["INSERT", null, viaShipment], ["UPDATE", viaShipment + " OR executor_org_id = app_org() OR EXISTS (SELECT 1 FROM tenders t WHERE t.leg_id = shipment_legs.id AND t.to_org_id = app_org())", "true"]]);
table("inspections", [["SELECT", viaShipment], ["INSERT", null, viaShipment + " AND org_id = app_org()"], ["UPDATE", "org_id = app_org()", "org_id = app_org()"]]);
table("inspection_damages", [
  ["SELECT", "EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_id)"],
  ["INSERT", null, "EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_id AND i.org_id = app_org())"],
  ["DELETE", "EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_id AND i.org_id = app_org())"],
]);
table("tenders", [
  ["SELECT", "from_org_id = app_org() OR to_org_id = app_org()"],
  ["INSERT", null, "from_org_id = app_org()"],
  ["UPDATE", "from_org_id = app_org() OR to_org_id = app_org()", "from_org_id = app_org() OR to_org_id = app_org()"],
]);
table("shipment_status_history", [["SELECT", viaShipment], ["INSERT", null, viaShipment]]);
table("shipment_events", [
  // Private events (e.g. a provider's own quote submission) stay readable by their org even before it becomes a party.
  ["SELECT", "visible_to_org_id = app_org() OR (visible_to_org_id IS NULL AND " + viaShipment + ")"],
  ["INSERT", null, "app_is_party(shipment_id) OR app_can_preview(shipment_id)"],
]);
table("location_pings", [["SELECT", viaShipment], ["INSERT", null, viaShipment]]);
table("shipment_exceptions", [
  ["SELECT", viaShipment + " AND (customer_visible OR NOT app_is_customer(shipment_id) OR opened_by_org_id = app_org())"],
  ["INSERT", null, viaShipment],
  ["UPDATE", viaShipment, viaShipment],
]);
table("quotes", [
  ["SELECT", "provider_org_id = app_org() OR app_is_customer(shipment_id)"],
  ["INSERT", null, "provider_org_id = app_org() AND app_can_preview(shipment_id)"],
  ["UPDATE", "provider_org_id = app_org() OR app_is_customer(shipment_id)", "true"],
]);
table("quote_lines", [
  ["SELECT", "EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id)"],
  ["INSERT", null, "EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND q.provider_org_id = app_org())"],
]);
table("charges", [
  ["SELECT", "biller_org_id = app_org() OR bill_to_org_id = app_org()"],
  ["INSERT", null, "(biller_org_id = app_org() OR bill_to_org_id = app_org()) AND app_is_party(shipment_id)"],
  ["UPDATE", "biller_org_id = app_org() OR bill_to_org_id = app_org()", "biller_org_id = app_org() OR bill_to_org_id = app_org()"],
]);
table("invoices", [
  ["SELECT", "issuer_org_id = app_org() OR bill_to_org_id = app_org()"],
  ["INSERT", null, "issuer_org_id = app_org()"],
  ["UPDATE", "issuer_org_id = app_org() OR bill_to_org_id = app_org()", "issuer_org_id = app_org() OR bill_to_org_id = app_org()"],
]);
table("invoice_lines", [
  ["SELECT", "EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id)"],
  ["INSERT", null, "EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.issuer_org_id = app_org())"],
]);
table("credit_notes", [
  ["SELECT", "EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id)"],
  ["INSERT", null, "EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.issuer_org_id = app_org())"],
]);
table("payments", [
  ["SELECT", "payer_org_id = app_org() OR payee_org_id = app_org()"],
  ["INSERT", null, "payer_org_id = app_org()"],
]);
table("payables", [
  ["SELECT", "payer_org_id = app_org() OR payee_org_id = app_org()"],
  ["INSERT", null, "payer_org_id = app_org() OR payee_org_id = app_org()"],
  ["UPDATE", "payer_org_id = app_org()", "payer_org_id = app_org()"],
]);
const docVisible = `owner_org_id = app_org()
  OR (visibility = 'SHARED' AND shipment_id IS NOT NULL AND app_is_party(shipment_id) AND (customer_visible OR NOT app_is_customer(shipment_id)))
  OR (visibility = 'SHARED' AND shipment_id IS NULL AND subject_org_id IS NOT NULL AND category IN ('INSURANCE_CERTIFICATE','OPERATING_AUTHORITY'))`;
table("documents", [
  ["SELECT", docVisible],
  ["INSERT", null, "owner_org_id = app_org() AND (shipment_id IS NULL OR app_is_party(shipment_id))"],
  ["UPDATE", "owner_org_id = app_org() OR (shipment_id IS NOT NULL AND app_is_party(shipment_id) AND NOT app_is_customer(shipment_id) AND visibility = 'SHARED')", "true"],
]);
table("document_versions", [
  ["SELECT", "EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id)"],
  ["INSERT", null, "EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id)"],
  ["UPDATE", "EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id AND d.owner_org_id = app_org())", "true"],
]);
table("document_extractions", ALL("org_id = app_org()"));
table("document_requirements", [["SELECT", viaShipment], ["INSERT", null, viaShipment + " AND requested_by_org_id = app_org()"], ["UPDATE", viaShipment, viaShipment]]);
table("customs_entries", [
  ["SELECT", "broker_org_id = app_org() OR app_is_customer(shipment_id)"],
  ["INSERT", null, "broker_org_id = app_org() AND app_is_party(shipment_id)"],
  ["UPDATE", "broker_org_id = app_org()", "broker_org_id = app_org()"],
]);
table("customs_lines", [
  ["SELECT", "EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id)"],
  ["INSERT", null, "EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id AND e.broker_org_id = app_org())"],
  ["UPDATE", "EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id AND e.broker_org_id = app_org())", "true"],
  ["DELETE", "EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id AND e.broker_org_id = app_org())"],
]);
table("tasks", ALL("org_id = app_org()"));
table("messages", [
  ["SELECT", viaShipment + " AND (visibility = 'SHARED' OR org_id = app_org())"],
  ["INSERT", null, viaShipment + " AND org_id = app_org()"],
]);
table("notifications", [["SELECT", "user_id = app_user()"], ["UPDATE", "user_id = app_user()", "user_id = app_user()"]]);
table("notification_preferences", ALL("user_id = app_user()"));
table("tracking_links", [["SELECT", viaShipment], ["INSERT", null, viaShipment + " AND created_by_org_id = app_org()"], ["UPDATE", viaShipment, viaShipment]]);
table("saved_views", ALL("user_id = app_user() AND org_id = app_org()"));
table("audit_log", [["SELECT", "org_id = app_org()"], ["INSERT", null, "true"]]);

s(`GRANT USAGE ON SCHEMA public TO vicora_app;`);
s(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tenant.map((t) => `"${t}"`).join(", ")} TO vicora_app;`);
// Users: the app role may read display columns only; never password hashes.
s(`GRANT SELECT (id, email, name, phone, timezone, is_platform_admin, is_demo) ON "users" TO vicora_app;`);
s(`GRANT INSERT ON "jobs" TO vicora_app;`);
s(`GRANT SELECT, INSERT, UPDATE ON "counters" TO vicora_app;`);
s(`GRANT USAGE, SELECT ON SEQUENCE shipment_ref_seq TO vicora_app;`);
s(`GRANT EXECUTE ON FUNCTION app_org(), app_user(), app_org_type(), app_is_party(uuid), app_is_customer(uuid), app_can_preview(uuid), app_equipment_availability() TO vicora_app;`);

writeFileSync(new URL("../drizzle/0001_rls.sql", import.meta.url), out.join("\n--> statement-breakpoint\n") + "\n");
console.log(`0001: wrote ${out.length} statements for ${tenant.length} tables`);

/* ---------------------------------------------------------------- 0003: customs brokerage core */
// Applied migrations are immutable, so tables added later get their policies in a later file.
out.length = 0;
tenant.length = 0;
const broker = "broker_org_id = app_org()";
table("customs_clients", ALL(broker));
table("classification_items", ALL(broker));
table("customs_deadline_rules", ALL(broker));
// The importer can see deadlines on its own entries (customs_entries RLS decides which entries are visible).
table("customs_deadlines", [
  ["SELECT", broker + " OR EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id)"],
  ["INSERT", null, broker],
  ["UPDATE", broker, broker],
  ["DELETE", broker],
]);
table("customs_reviews", ALL(broker));
table("customs_questions", ALL(broker));
s(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${tenant.map((t) => `"${t}"`).join(", ")} TO vicora_app;`);
writeFileSync(new URL("../drizzle/0003_customs_rls.sql", import.meta.url), out.join("\n--> statement-breakpoint\n") + "\n");
console.log(`0003: wrote ${out.length} statements for ${tenant.length} tables`);
