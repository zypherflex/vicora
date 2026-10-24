import type { Metadata } from "next";
import { Card, Notice, PageHeader } from "@/components/ui";
import { load } from "@/server/page";
import { listDeadlineRules } from "@/server/services/brokerage";
import { DeadlineRuleForm } from "../clients/forms";

export const metadata: Metadata = { title: "Deadline rules" };

export default async function RulesPage() {
  const { rules, canApprove } = await load(async (ctx) => ({ rules: await listDeadlineRules(ctx), canApprove: ctx.perms.has("customs.approve") }), { need: "customs.read" });
  return (
    <>
      <PageHeader title="Deadline rules" subtitle="How Vicora computes due dates on every entry. Changes recompute open deadlines on active entries." />
      <Notice tone="amber">
        Vicora ships these as starting templates with the reference each one is based on. They are not legal advice and Vicora does not track regulatory changes. A licensed broker should confirm each rule against current CBP guidance. Federal holidays are not excluded from business-day counts.
      </Notice>
      <div className="mt-4 space-y-4">
        {rules.map((r) => (
          <Card key={r.id} title={`${r.key}${r.isDefaultTemplate ? " · default template" : " · customized"}`}>
            <DeadlineRuleForm rule={r} canApprove={canApprove} />
          </Card>
        ))}
      </div>
    </>
  );
}
