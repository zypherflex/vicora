"use client";

import { useState } from "react";
import { InspectionForm } from "@/components/driver/inspection-form";
import { buttonClass } from "@/components/ui";

export function InspectLauncher({ shipmentId, vehicle, kind }: { shipmentId: string; vehicle: { id: string; label: string }; kind: "PICKUP" | "DELIVERY" }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className={buttonClass("primary", "sm")} onClick={() => setOpen(true)}>
        Start {kind === "PICKUP" ? "pickup" : "delivery"} inspection
      </button>
    );
  return (
    <div className="mt-3 rounded-lg border border-brand-100 bg-white p-3">
      <InspectionForm shipmentId={shipmentId} vehicle={vehicle} kind={kind} onDone={() => setOpen(false)} />
    </div>
  );
}
