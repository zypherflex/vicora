ALTER TABLE "customs_clients" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customs_clients_select ON "customs_clients" FOR SELECT TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_clients_insert ON "customs_clients" FOR INSERT TO vicora_app  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_clients_update ON "customs_clients" FOR UPDATE TO vicora_app USING (broker_org_id = app_org())  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_clients_delete ON "customs_clients" FOR DELETE TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "classification_items" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY classification_items_select ON "classification_items" FOR SELECT TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY classification_items_insert ON "classification_items" FOR INSERT TO vicora_app  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY classification_items_update ON "classification_items" FOR UPDATE TO vicora_app USING (broker_org_id = app_org())  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY classification_items_delete ON "classification_items" FOR DELETE TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "customs_deadline_rules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customs_deadline_rules_select ON "customs_deadline_rules" FOR SELECT TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_deadline_rules_insert ON "customs_deadline_rules" FOR INSERT TO vicora_app  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_deadline_rules_update ON "customs_deadline_rules" FOR UPDATE TO vicora_app USING (broker_org_id = app_org())  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_deadline_rules_delete ON "customs_deadline_rules" FOR DELETE TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "customs_deadlines" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customs_deadlines_select ON "customs_deadlines" FOR SELECT TO vicora_app USING (broker_org_id = app_org() OR EXISTS (SELECT 1 FROM customs_entries e WHERE e.id = entry_id));
--> statement-breakpoint
CREATE POLICY customs_deadlines_insert ON "customs_deadlines" FOR INSERT TO vicora_app  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_deadlines_update ON "customs_deadlines" FOR UPDATE TO vicora_app USING (broker_org_id = app_org())  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_deadlines_delete ON "customs_deadlines" FOR DELETE TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "customs_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customs_reviews_select ON "customs_reviews" FOR SELECT TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_reviews_insert ON "customs_reviews" FOR INSERT TO vicora_app  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_reviews_update ON "customs_reviews" FOR UPDATE TO vicora_app USING (broker_org_id = app_org())  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_reviews_delete ON "customs_reviews" FOR DELETE TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
ALTER TABLE "customs_questions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY customs_questions_select ON "customs_questions" FOR SELECT TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_questions_insert ON "customs_questions" FOR INSERT TO vicora_app  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_questions_update ON "customs_questions" FOR UPDATE TO vicora_app USING (broker_org_id = app_org())  WITH CHECK (broker_org_id = app_org());
--> statement-breakpoint
CREATE POLICY customs_questions_delete ON "customs_questions" FOR DELETE TO vicora_app USING (broker_org_id = app_org());
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "customs_clients", "classification_items", "customs_deadline_rules", "customs_deadlines", "customs_reviews", "customs_questions" TO vicora_app;
