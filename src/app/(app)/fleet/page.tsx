import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { EQUIPMENT_LABEL, type EquipmentType } from "@/lib/domain";
import { formatInTimeZone } from "@/lib/time";
import { load } from "@/server/page";
import { listFleet, unassignedVehicles } from "@/server/services/fleet";
import { DriverForm, EquipmentForm, EquipmentStatus, TripPlanner } from "./forms";

export const metadata: Metadata = { title: "Fleet & trips" };

export default async function FleetPage() {
  const { fleet, waiting, tz, canManage, isAuto } = await load(
    async (ctx) => ({
      fleet: await listFleet(ctx),
      waiting: ctx.org.type === "AUTO_TRANSPORT" ? await unassignedVehicles(ctx) : [],
      tz: ctx.org.timezone,
      canManage: ctx.perms.has("fleet.manage"),
      isAuto: ctx.org.type === "AUTO_TRANSPORT",
    }),
    { need: "fleet.read" },
  );
  const soon = (d: Date | null) => d && +d - Date.now() < 30 * 86400_000;
  return (
    <>
      <PageHeader title="Fleet & trips" subtitle="Drivers, equipment and multi-vehicle trip planning." />
      <div className="space-y-6">
        {isAuto && (
          <Card title="Plan a car-carrier trip">
            <TripPlanner
              carriers={fleet.equipment.filter((e) => e.vehicleCapacity).map((e) => ({ id: e.id, label: `${e.unitNumber} · ${e.vehicleCapacity} slots · ${EQUIPMENT_LABEL[e.type as EquipmentType] ?? e.type}`, capacity: e.vehicleCapacity!, enclosed: e.type === "CAR_CARRIER_ENCLOSED" }))}
              drivers={fleet.drivers.filter((d) => d.status !== "INACTIVE").map((d) => ({ id: d.id, name: d.name }))}
              vehicles={waiting.map((v) => ({ id: v.id, label: `${v.year} ${v.make} ${v.model} · ${v.reference}${v.transportType === "ENCLOSED" ? " · enclosed" : ""}${v.operable ? "" : " · inoperable"}`, enclosed: v.transportType === "ENCLOSED" }))}
            />
          </Card>
        )}
        {fleet.trips.length > 0 && (
          <Card title="Trips" pad={false}>
            <Table head={["Trip", "Unit", "Load", "Start", "Status"]}>
              {fleet.trips.map((t) => (
                <tr key={t.id}>
                  <Td>{t.name}</Td>
                  <Td>{fleet.equipment.find((e) => e.id === t.equipmentId)?.unitNumber ?? "—"}</Td>
                  <Td className="whitespace-normal">
                    <p className="text-xs font-medium">
                      {t.vehicles.length}/{t.capacity} slots
                    </p>
                    <ul className="text-xs text-slate-600">
                      {t.vehicles.map((v) => (
                        <li key={v.id}>
                          <Link className="hover:underline" href={`/shipments/${v.shipmentId}?tab=vehicles`}>
                            {v.year} {v.make} {v.model}
                          </Link>{" "}
                          · {v.status.toLowerCase().replace("_", " ")}
                        </li>
                      ))}
                    </ul>
                  </Td>
                  <Td>{formatInTimeZone(t.plannedStart, tz)}</Td>
                  <Td>
                    <StatusBadge status={t.status} />
                  </Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}
        <Card title={`Drivers (${fleet.drivers.length})`} pad={false}>
          <Table head={["Name", "Phone", "CDL", "App login", "Status"]}>
            {fleet.drivers.map((d) => (
              <tr key={d.id}>
                <Td>{d.name}</Td>
                <Td>{d.phone ?? "—"}</Td>
                <Td>
                  {d.licenseState ?? "—"} {d.licenseExpiresAt && <span className={soon(d.licenseExpiresAt) ? "text-red-600" : "text-slate-500"}>exp {formatInTimeZone(d.licenseExpiresAt, tz, { dateOnly: true })}</span>}
                </Td>
                <Td>{d.userId ? <Badge tone="green">Linked</Badge> : <Badge>None</Badge>}</Td>
                <Td>
                  <StatusBadge status={d.status === "AVAILABLE" ? "CONFIRMED" : d.status === "ON_TRIP" ? "IN_TRANSIT" : "VOID"} label={d.status.replace("_", " ").toLowerCase()} />
                </Td>
              </tr>
            ))}
          </Table>
          {canManage && (
            <div className="border-t border-slate-100 p-4">
              <DriverForm />
            </div>
          )}
        </Card>
        <Card title={`Equipment (${fleet.equipment.length})`} pad={false}>
          <Table head={["Unit", "Type", "Capacity", "Plate", "Location", "Status"]}>
            {fleet.equipment.map((e) => (
              <tr key={e.id}>
                <Td className="font-medium">{e.unitNumber}</Td>
                <Td>{EQUIPMENT_LABEL[e.type as EquipmentType] ?? e.type}</Td>
                <Td>{e.vehicleCapacity ? `${e.vehicleCapacity} vehicles` : e.maxWeightLb ? `${e.maxWeightLb.toLocaleString()} lb` : "—"}</Td>
                <Td>{e.plate ?? "—"}</Td>
                <Td>{e.currentCity ? `${e.currentCity}, ${e.currentState}` : "—"}</Td>
                <Td>{canManage ? <EquipmentStatus id={e.id} status={e.status} /> : <StatusBadge status={e.status} />}</Td>
              </tr>
            ))}
          </Table>
          {canManage && (
            <div className="border-t border-slate-100 p-4">
              <EquipmentForm />
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
