CREATE SEQUENCE IF NOT EXISTS shipment_ref_seq START 1001;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_org() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_user() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_org_type() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.org_type', true), '')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_party(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app_org() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM shipments s WHERE s.id = sid AND s.owner_org_id = app_org())
    OR EXISTS (SELECT 1 FROM shipment_parties p WHERE p.shipment_id = sid AND p.org_id = app_org())
  )
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_is_customer(sid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM shipments s WHERE s.id = sid AND s.owner_org_id = app_org())
$$;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_equipment_availability()
RETURNS TABLE (org_id uuid, type text, available integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.org_id, e.type, count(*)::int FROM equipment e
  WHERE e.status = 'AVAILABLE' AND (e.available_from IS NULL OR e.available_from <= now() + interval '3 days')
  GROUP BY e.org_id, e.type
$$;
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organizations_select ON "organizations" FOR SELECT TO vicora_app USING (true);
--> statement-breakpoint
CREATE POLICY organizations_update ON "organizations" FOR UPDATE TO vicora_app USING (id = app_org())  WITH CHECK (id = app_org());
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY memberships_select ON "memberships" FOR SELECT TO vicora_app USING (org_id = app_org() OR user_id = app_user());
--> statement-breakpoint
CREATE POLICY memberships_insert ON "memberships" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY memberships_update ON "memberships" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY memberships_delete ON "memberships" FOR DELETE TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invitations_select ON "invitations" FOR SELECT TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
CREATE POLICY invitations_insert ON "invitations" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY invitations_update ON "invitations" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY invitations_delete ON "invitations" FOR DELETE TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "provider_profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY provider_profiles_select ON "provider_profiles" FOR SELECT TO vicora_app USING (true);
--> statement-breakpoint
CREATE POLICY provider_profiles_insert ON "provider_profiles" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY provider_profiles_update ON "provider_profiles" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "compliance_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY compliance_records_select ON "compliance_records" FOR SELECT TO vicora_app USING (true);
--> statement-breakpoint
CREATE POLICY compliance_records_insert ON "compliance_records" FOR INSERT TO vicora_app  WITH CHECK (subject_org_id = app_org());
--> statement-breakpoint
CREATE POLICY compliance_records_update ON "compliance_records" FOR UPDATE TO vicora_app USING (subject_org_id = app_org() OR app_org_type() = 'FREIGHT_BROKER')  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "drivers" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY drivers_select ON "drivers" FOR SELECT TO vicora_app USING (org_id = app_org() OR EXISTS (SELECT 1 FROM shipment_legs l WHERE l.driver_id = drivers.id));
--> statement-breakpoint
CREATE POLICY drivers_insert ON "drivers" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY drivers_update ON "drivers" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY drivers_delete ON "drivers" FOR DELETE TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "equipment" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY equipment_select ON "equipment" FOR SELECT TO vicora_app USING (org_id = app_org() OR EXISTS (SELECT 1 FROM shipment_legs l WHERE l.equipment_id = equipment.id));
--> statement-breakpoint
CREATE POLICY equipment_insert ON "equipment" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY equipment_update ON "equipment" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY equipment_delete ON "equipment" FOR DELETE TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY trips_select ON "trips" FOR SELECT TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
CREATE POLICY trips_insert ON "trips" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY trips_update ON "trips" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY trips_delete ON "trips" FOR DELETE TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "shipments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipments_select ON "shipments" FOR SELECT TO vicora_app USING (app_is_party(id) OR app_can_preview(id));
--> statement-breakpoint
CREATE POLICY shipments_insert ON "shipments" FOR INSERT TO vicora_app  WITH CHECK (owner_org_id = app_org());
--> statement-breakpoint
CREATE POLICY shipments_update ON "shipments" FOR UPDATE TO vicora_app USING (app_is_party(id))  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "shipment_parties" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_parties_select ON "shipment_parties" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) OR app_can_preview(shipment_id) OR org_id = app_org());
--> statement-breakpoint
CREATE POLICY shipment_parties_insert ON "shipment_parties" FOR INSERT TO vicora_app  WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY shipment_parties_delete ON "shipment_parties" FOR DELETE TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "quote_invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quote_invitations_select ON "quote_invitations" FOR SELECT TO vicora_app USING (app_is_customer(shipment_id) OR provider_org_id = app_org());
--> statement-breakpoint
CREATE POLICY quote_invitations_insert ON "quote_invitations" FOR INSERT TO vicora_app  WITH CHECK (app_is_customer(shipment_id));
--> statement-breakpoint
CREATE POLICY quote_invitations_delete ON "quote_invitations" FOR DELETE TO vicora_app USING (app_is_customer(shipment_id));
--> statement-breakpoint
ALTER TABLE "shipment_stops" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_stops_select ON "shipment_stops" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) OR app_can_preview(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_stops_insert ON "shipment_stops" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_stops_update ON "shipment_stops" FOR UPDATE TO vicora_app USING (app_is_party(shipment_id))  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_stops_delete ON "shipment_stops" FOR DELETE TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "shipment_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_items_select ON "shipment_items" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) OR app_can_preview(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_items_insert ON "shipment_items" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_items_update ON "shipment_items" FOR UPDATE TO vicora_app USING (app_is_party(shipment_id))  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_items_delete ON "shipment_items" FOR DELETE TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "shipment_vehicles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_vehicles_select ON "shipment_vehicles" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) OR app_can_preview(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_vehicles_insert ON "shipment_vehicles" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_vehicles_update ON "shipment_vehicles" FOR UPDATE TO vicora_app USING (app_is_party(shipment_id))  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_vehicles_delete ON "shipment_vehicles" FOR DELETE TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "shipment_legs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_legs_select ON "shipment_legs" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) OR app_can_preview(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_legs_insert ON "shipment_legs" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_legs_update ON "shipment_legs" FOR UPDATE TO vicora_app USING (app_is_party(shipment_id) OR executor_org_id = app_org() OR EXISTS (SELECT 1 FROM tenders t WHERE t.leg_id = shipment_legs.id AND t.to_org_id = app_org()))  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "inspections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inspections_select ON "inspections" FOR SELECT TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY inspections_insert ON "inspections" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id) AND org_id = app_org());
--> statement-breakpoint
CREATE POLICY inspections_update ON "inspections" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "inspection_damages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY inspection_damages_select ON "inspection_damages" FOR SELECT TO vicora_app USING (EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_id));
--> statement-breakpoint
CREATE POLICY inspection_damages_insert ON "inspection_damages" FOR INSERT TO vicora_app  WITH CHECK (EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_id AND i.org_id = app_org()));
--> statement-breakpoint
CREATE POLICY inspection_damages_delete ON "inspection_damages" FOR DELETE TO vicora_app USING (EXISTS (SELECT 1 FROM inspections i WHERE i.id = inspection_id AND i.org_id = app_org()));
--> statement-breakpoint
ALTER TABLE "tenders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenders_select ON "tenders" FOR SELECT TO vicora_app USING (from_org_id = app_org() OR to_org_id = app_org());
--> statement-breakpoint
CREATE POLICY tenders_insert ON "tenders" FOR INSERT TO vicora_app  WITH CHECK (from_org_id = app_org());
--> statement-breakpoint
CREATE POLICY tenders_update ON "tenders" FOR UPDATE TO vicora_app USING (from_org_id = app_org() OR to_org_id = app_org())  WITH CHECK (from_org_id = app_org() OR to_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "shipment_status_history" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_status_history_select ON "shipment_status_history" FOR SELECT TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_status_history_insert ON "shipment_status_history" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "shipment_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_events_select ON "shipment_events" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) AND (visible_to_org_id IS NULL OR visible_to_org_id = app_org()));
--> statement-breakpoint
CREATE POLICY shipment_events_insert ON "shipment_events" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id) OR app_can_preview(shipment_id));
--> statement-breakpoint
ALTER TABLE "location_pings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY location_pings_select ON "location_pings" FOR SELECT TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY location_pings_insert ON "location_pings" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "shipment_exceptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY shipment_exceptions_select ON "shipment_exceptions" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) AND (customer_visible OR NOT app_is_customer(shipment_id) OR opened_by_org_id = app_org()));
--> statement-breakpoint
CREATE POLICY shipment_exceptions_insert ON "shipment_exceptions" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY shipment_exceptions_update ON "shipment_exceptions" FOR UPDATE TO vicora_app USING (app_is_party(shipment_id))  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quotes_select ON "quotes" FOR SELECT TO vicora_app USING (provider_org_id = app_org() OR app_is_customer(shipment_id));
--> statement-breakpoint
CREATE POLICY quotes_insert ON "quotes" FOR INSERT TO vicora_app  WITH CHECK (provider_org_id = app_org() AND app_can_preview(shipment_id));
--> statement-breakpoint
CREATE POLICY quotes_update ON "quotes" FOR UPDATE TO vicora_app USING (provider_org_id = app_org() OR app_is_customer(shipment_id))  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "quote_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY quote_lines_select ON "quote_lines" FOR SELECT TO vicora_app USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id));
--> statement-breakpoint
CREATE POLICY quote_lines_insert ON "quote_lines" FOR INSERT TO vicora_app  WITH CHECK (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND q.provider_org_id = app_org()));
--> statement-breakpoint
ALTER TABLE "charges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY charges_select ON "charges" FOR SELECT TO vicora_app USING (biller_org_id = app_org() OR bill_to_org_id = app_org());
--> statement-breakpoint
CREATE POLICY charges_insert ON "charges" FOR INSERT TO vicora_app  WITH CHECK ((biller_org_id = app_org() OR bill_to_org_id = app_org()) AND app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY charges_update ON "charges" FOR UPDATE TO vicora_app USING (biller_org_id = app_org() OR bill_to_org_id = app_org())  WITH CHECK (biller_org_id = app_org() OR bill_to_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoices_select ON "invoices" FOR SELECT TO vicora_app USING (issuer_org_id = app_org() OR bill_to_org_id = app_org());
--> statement-breakpoint
CREATE POLICY invoices_insert ON "invoices" FOR INSERT TO vicora_app  WITH CHECK (issuer_org_id = app_org());
--> statement-breakpoint
CREATE POLICY invoices_update ON "invoices" FOR UPDATE TO vicora_app USING (issuer_org_id = app_org() OR bill_to_org_id = app_org())  WITH CHECK (issuer_org_id = app_org() OR bill_to_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invoice_lines_select ON "invoice_lines" FOR SELECT TO vicora_app USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id));
--> statement-breakpoint
CREATE POLICY invoice_lines_insert ON "invoice_lines" FOR INSERT TO vicora_app  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.issuer_org_id = app_org()));
--> statement-breakpoint
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY credit_notes_select ON "credit_notes" FOR SELECT TO vicora_app USING (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id));
--> statement-breakpoint
CREATE POLICY credit_notes_insert ON "credit_notes" FOR INSERT TO vicora_app  WITH CHECK (EXISTS (SELECT 1 FROM invoices i WHERE i.id = invoice_id AND i.issuer_org_id = app_org()));
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payments_select ON "payments" FOR SELECT TO vicora_app USING (payer_org_id = app_org() OR payee_org_id = app_org());
--> statement-breakpoint
CREATE POLICY payments_insert ON "payments" FOR INSERT TO vicora_app  WITH CHECK (payer_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "payables" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payables_select ON "payables" FOR SELECT TO vicora_app USING (payer_org_id = app_org() OR payee_org_id = app_org());
--> statement-breakpoint
CREATE POLICY payables_insert ON "payables" FOR INSERT TO vicora_app  WITH CHECK (payer_org_id = app_org() OR payee_org_id = app_org());
--> statement-breakpoint
CREATE POLICY payables_update ON "payables" FOR UPDATE TO vicora_app USING (payer_org_id = app_org())  WITH CHECK (payer_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY documents_select ON "documents" FOR SELECT TO vicora_app USING (owner_org_id = app_org()
  OR (visibility = 'SHARED' AND shipment_id IS NOT NULL AND app_is_party(shipment_id) AND (customer_visible OR NOT app_is_customer(shipment_id)))
  OR (visibility = 'SHARED' AND shipment_id IS NULL AND subject_org_id IS NOT NULL AND category IN ('INSURANCE_CERTIFICATE','OPERATING_AUTHORITY')));
--> statement-breakpoint
CREATE POLICY documents_insert ON "documents" FOR INSERT TO vicora_app  WITH CHECK (owner_org_id = app_org() AND (shipment_id IS NULL OR app_is_party(shipment_id)));
--> statement-breakpoint
CREATE POLICY documents_update ON "documents" FOR UPDATE TO vicora_app USING (owner_org_id = app_org() OR (shipment_id IS NOT NULL AND app_is_party(shipment_id) AND NOT app_is_customer(shipment_id) AND visibility = 'SHARED'))  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "document_versions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_versions_select ON "document_versions" FOR SELECT TO vicora_app USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id));
--> statement-breakpoint
CREATE POLICY document_versions_insert ON "document_versions" FOR INSERT TO vicora_app  WITH CHECK (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id));
--> statement-breakpoint
CREATE POLICY document_versions_update ON "document_versions" FOR UPDATE TO vicora_app USING (EXISTS (SELECT 1 FROM documents d WHERE d.id = document_id AND d.owner_org_id = app_org()))  WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "document_extractions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_extractions_select ON "document_extractions" FOR SELECT TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
CREATE POLICY document_extractions_insert ON "document_extractions" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY document_extractions_update ON "document_extractions" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY document_extractions_delete ON "document_extractions" FOR DELETE TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "document_requirements" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY document_requirements_select ON "document_requirements" FOR SELECT TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY document_requirements_insert ON "document_requirements" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id) AND requested_by_org_id = app_org());
--> statement-breakpoint
CREATE POLICY document_requirements_update ON "document_requirements" FOR UPDATE TO vicora_app USING (app_is_party(shipment_id))  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "customs_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customs_entries_select ON "customs_entries" FOR SELECT TO vicora_app USING (broker_org_id = app_org() OR app_is_customer(shipment_id));
--> statement-breakpoint
CREATE POLICY customs_entries_insert ON "customs_entries" FOR INSERT TO vicora_app  WITH CHECK (broker_org_id = app_org() AND app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY customs_entries_update ON "customs_entries" FOR UPDATE TO vicora_app USING (broker_org_id = app_org())  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "customs_lines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customs_lines_select ON "customs_lines" FOR SELECT TO vicora_app USING (EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id));
--> statement-breakpoint
CREATE POLICY customs_lines_insert ON "customs_lines" FOR INSERT TO vicora_app  WITH CHECK (EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id AND e.broker_org_id = app_org()));
--> statement-breakpoint
CREATE POLICY customs_lines_update ON "customs_lines" FOR UPDATE TO vicora_app USING (EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id AND e.broker_org_id = app_org()))  WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY customs_lines_delete ON "customs_lines" FOR DELETE TO vicora_app USING (EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id AND e.broker_org_id = app_org()));
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tasks_select ON "tasks" FOR SELECT TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
CREATE POLICY tasks_insert ON "tasks" FOR INSERT TO vicora_app  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY tasks_update ON "tasks" FOR UPDATE TO vicora_app USING (org_id = app_org())  WITH CHECK (org_id = app_org());
--> statement-breakpoint
CREATE POLICY tasks_delete ON "tasks" FOR DELETE TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY messages_select ON "messages" FOR SELECT TO vicora_app USING (app_is_party(shipment_id) AND (visibility = 'SHARED' OR org_id = app_org()));
--> statement-breakpoint
CREATE POLICY messages_insert ON "messages" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id) AND org_id = app_org());
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notifications_select ON "notifications" FOR SELECT TO vicora_app USING (user_id = app_user());
--> statement-breakpoint
CREATE POLICY notifications_update ON "notifications" FOR UPDATE TO vicora_app USING (user_id = app_user())  WITH CHECK (user_id = app_user());
--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY notification_preferences_select ON "notification_preferences" FOR SELECT TO vicora_app USING (user_id = app_user());
--> statement-breakpoint
CREATE POLICY notification_preferences_insert ON "notification_preferences" FOR INSERT TO vicora_app  WITH CHECK (user_id = app_user());
--> statement-breakpoint
CREATE POLICY notification_preferences_update ON "notification_preferences" FOR UPDATE TO vicora_app USING (user_id = app_user())  WITH CHECK (user_id = app_user());
--> statement-breakpoint
CREATE POLICY notification_preferences_delete ON "notification_preferences" FOR DELETE TO vicora_app USING (user_id = app_user());
--> statement-breakpoint
ALTER TABLE "tracking_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tracking_links_select ON "tracking_links" FOR SELECT TO vicora_app USING (app_is_party(shipment_id));
--> statement-breakpoint
CREATE POLICY tracking_links_insert ON "tracking_links" FOR INSERT TO vicora_app  WITH CHECK (app_is_party(shipment_id) AND created_by_org_id = app_org());
--> statement-breakpoint
CREATE POLICY tracking_links_update ON "tracking_links" FOR UPDATE TO vicora_app USING (app_is_party(shipment_id))  WITH CHECK (app_is_party(shipment_id));
--> statement-breakpoint
ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY saved_views_select ON "saved_views" FOR SELECT TO vicora_app USING (user_id = app_user() AND org_id = app_org());
--> statement-breakpoint
CREATE POLICY saved_views_insert ON "saved_views" FOR INSERT TO vicora_app  WITH CHECK (user_id = app_user() AND org_id = app_org());
--> statement-breakpoint
CREATE POLICY saved_views_update ON "saved_views" FOR UPDATE TO vicora_app USING (user_id = app_user() AND org_id = app_org())  WITH CHECK (user_id = app_user() AND org_id = app_org());
--> statement-breakpoint
CREATE POLICY saved_views_delete ON "saved_views" FOR DELETE TO vicora_app USING (user_id = app_user() AND org_id = app_org());
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_log_select ON "audit_log" FOR SELECT TO vicora_app USING (org_id = app_org());
--> statement-breakpoint
CREATE POLICY audit_log_insert ON "audit_log" FOR INSERT TO vicora_app  WITH CHECK (true);
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO vicora_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "organizations", "memberships", "invitations", "provider_profiles", "compliance_records", "drivers", "equipment", "trips", "shipments", "shipment_parties", "quote_invitations", "shipment_stops", "shipment_items", "shipment_vehicles", "shipment_legs", "inspections", "inspection_damages", "tenders", "shipment_status_history", "shipment_events", "location_pings", "shipment_exceptions", "quotes", "quote_lines", "charges", "invoices", "invoice_lines", "credit_notes", "payments", "payables", "documents", "document_versions", "document_extractions", "document_requirements", "customs_entries", "customs_lines", "tasks", "messages", "notifications", "notification_preferences", "tracking_links", "saved_views", "audit_log" TO vicora_app;
--> statement-breakpoint
GRANT SELECT (id, email, name, phone, timezone, is_platform_admin, is_demo) ON "users" TO vicora_app;
--> statement-breakpoint
GRANT INSERT ON "jobs" TO vicora_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "counters" TO vicora_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE shipment_ref_seq TO vicora_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_org(), app_user(), app_org_type(), app_is_party(uuid), app_is_customer(uuid), app_can_preview(uuid), app_equipment_availability() TO vicora_app;
