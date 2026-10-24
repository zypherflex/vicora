import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { PageHeader } from "@/components/ui";
import { organizations } from "@/server/db/schema";
import { load } from "@/server/page";
import { BookingWizard } from "./wizard";

export const metadata: Metadata = { title: "Book a shipment" };

export default async function NewShipmentPage() {
  const providers = await load(
    (ctx) =>
      ctx.db
        .select({ id: organizations.id, name: organizations.name, type: organizations.type, state: organizations.state })
        .from(organizations)
        .where(inArray(organizations.type, ["FREIGHT_BROKER", "CARRIER", "AUTO_TRANSPORT"]))
        .orderBy(organizations.name),
    { need: "shipment.create" },
  );
  return (
    <>
      <PageHeader title="Book a shipment" subtitle="Describe the move once. Providers quote against the same record your whole team tracks." />
      <BookingWizard providers={providers} />
    </>
  );
}
