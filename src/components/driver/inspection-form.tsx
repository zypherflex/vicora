"use client";

import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { Badge, buttonClass, cx, Notice } from "@/components/ui";
import { Field, FormStatus, useSubmit } from "@/components/ui/client";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";

const AREAS = ["Front bumper", "Hood", "Windshield", "Roof", "Driver front door", "Driver rear door", "Passenger front door", "Passenger rear door", "Driver quarter panel", "Passenger quarter panel", "Trunk / liftgate", "Rear bumper", "Wheels / tires", "Mirrors", "Interior", "Undercarriage"];
const TYPES = ["SCRATCH", "DENT", "CHIP", "CRACK", "MISSING", "BROKEN", "OTHER"] as const;

interface Photo { file: File; url: string }
interface Damage { area: string; damageType: (typeof TYPES)[number]; severity: "MINOR" | "MODERATE" | "MAJOR"; photoIndex: number | null; x: number | null; y: number | null; note: string }

/**
 * Electronic condition report: photos, tap-to-mark damage on a photo, odometer, and the
 * shipper/receiver signature. Files upload to the shipment first; the inspection references them.
 */
export function InspectionForm({ shipmentId, vehicle, kind, onDone }: { shipmentId: string; vehicle: { id: string; label: string }; kind: "PICKUP" | "DELIVERY"; onDone?: () => void }) {
  const { pending, error, ok, run } = useSubmit();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [active, setActive] = useState(0);
  const [damages, setDamages] = useState<Damage[]>([]);
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [signer, setSigner] = useState("");
  const sig = useRef<SignaturePadHandle>(null);
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    setPhotos((xs) => [...xs, ...Array.from(files).map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }

  async function upload(file: Blob, name: string, category: string, title: string) {
    const form = new FormData();
    form.set("file", new File([file], name, { type: file.type }));
    form.set("category", category);
    form.set("title", title);
    const r = await api<{ documentId: string }>(`/shipments/${shipmentId}/documents`, { form });
    return r.documentId;
  }

  async function position() {
    if (!("geolocation" in navigator)) return null;
    return new Promise<{ lat: number; lng: number } | null>((resolve) => navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve(null), { timeout: 6000 }));
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          if (photos.length < 1) throw new Error("Take at least one photo of the vehicle.");
          if (!signer.trim() || sig.current?.isEmpty()) throw new Error(`Get the ${kind === "PICKUP" ? "shipper's" : "receiver's"} name and signature.`);
          const photoIds: string[] = [];
          for (const [i, p] of photos.entries()) photoIds.push(await upload(p.file, p.file.name || `photo-${i + 1}.jpg`, "VEHICLE_PHOTO", `${kind === "PICKUP" ? "Pickup" : "Delivery"} photo ${i + 1}: ${vehicle.label}`));
          const blob = await sig.current!.toBlob();
          const signatureDocumentId = blob ? await upload(blob, "signature.png", "SIGNATURE", `${kind === "PICKUP" ? "Pickup" : "Delivery"} signature: ${signer}`) : null;
          const pos = await position();
          return api(`/shipments/${shipmentId}/inspections`, {
            body: {
              vehicleId: vehicle.id,
              kind,
              odometer: odometer ? Number(odometer) : null,
              notes: notes || null,
              signerName: signer,
              signatureDocumentId,
              photoDocumentIds: photoIds,
              lat: pos?.lat ?? null,
              lng: pos?.lng ?? null,
              damages: damages.map((d) => ({ area: d.area, damageType: d.damageType, severity: d.severity, photoDocumentId: d.photoIndex != null ? photoIds[d.photoIndex] : null, x: d.x, y: d.y, note: d.note || null })),
            },
          });
        }, "Condition report saved.", () => onDone?.());
      }}
    >
      <div>
        <p className="label">Photos ({photos.length})</p>
        <label className={cx(buttonClass("secondary"), "cursor-pointer")}>
          <Camera className="h-4 w-4" /> Take or add photos
          <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
        </label>
        {photos.length > 0 && (
          <>
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {photos.map((p, i) => (
                <button type="button" key={p.url} onClick={() => setActive(i)} className={cx("relative h-16 w-20 shrink-0 overflow-hidden rounded border-2", i === active ? "border-brand-600" : "border-transparent")}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                  <span
                    role="button"
                    aria-label="Remove photo"
                    className="absolute right-0 top-0 bg-black/50 p-0.5 text-white"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setPhotos((xs) => xs.filter((_, j) => j !== i));
                      setDamages((ds) => ds.filter((d) => d.photoIndex !== i).map((d) => ({ ...d, photoIndex: d.photoIndex != null && d.photoIndex > i ? d.photoIndex - 1 : d.photoIndex })));
                      setActive(0);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">Tap the photo where there is damage to mark it.</p>
            <div
              className="relative mt-1 max-w-md cursor-crosshair overflow-hidden rounded-md border border-slate-200"
              onClick={(e) => {
                const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
                const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
                setDamages((ds) => [...ds, { area: AREAS[0], damageType: "SCRATCH", severity: "MINOR", photoIndex: active, x, y, note: "" }]);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[active]?.url} alt="Selected vehicle photo" className="block w-full" />
              {damages.map((d, i) =>
                d.photoIndex === active && d.x != null && d.y != null ? (
                  <span key={i} className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white ring-2 ring-white" style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%` }}>
                    {i + 1}
                  </span>
                ) : null,
              )}
            </div>
          </>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <p className="label">Condition items ({damages.length})</p>
          <button type="button" className="text-xs text-brand-600 underline" onClick={() => setDamages((ds) => [...ds, { area: AREAS[0], damageType: "SCRATCH", severity: "MINOR", photoIndex: null, x: null, y: null, note: "" }])}>
            Add without photo mark
          </button>
        </div>
        {damages.length === 0 && <p className="text-xs text-slate-500">No damage noted. Mark any pre-existing damage so it is not attributed to this move.</p>}
        <ul className="space-y-2">
          {damages.map((d, i) => {
            const set = (p: Partial<Damage>) => setDamages((ds) => ds.map((x, j) => (j === i ? { ...x, ...p } : x)));
            return (
              <li key={i} className="grid grid-cols-2 gap-2 rounded-md border border-slate-200 p-2 sm:grid-cols-5">
                <span className="flex items-center gap-1 text-xs font-semibold">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white">{i + 1}</span>
                  {d.photoIndex != null ? `photo ${d.photoIndex + 1}` : "no mark"}
                </span>
                <select className="field py-1" value={d.area} onChange={(e) => set({ area: e.target.value })} aria-label="Area">
                  {AREAS.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </select>
                <select className="field py-1" value={d.damageType} onChange={(e) => set({ damageType: e.target.value as Damage["damageType"] })} aria-label="Damage type">
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.toLowerCase()}
                    </option>
                  ))}
                </select>
                <select className="field py-1" value={d.severity} onChange={(e) => set({ severity: e.target.value as Damage["severity"] })} aria-label="Severity">
                  {["MINOR", "MODERATE", "MAJOR"].map((t) => (
                    <option key={t} value={t}>
                      {t.toLowerCase()}
                    </option>
                  ))}
                </select>
                <div className="flex gap-1">
                  <input className="field py-1" placeholder="Note" value={d.note} onChange={(e) => set({ note: e.target.value })} aria-label="Note" />
                  <button type="button" aria-label="Remove item" className="px-1 text-slate-400" onClick={() => setDamages((ds) => ds.filter((_, j) => j !== i))}>
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Odometer">
          <input className="field" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Notes">
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2 rounded-md border border-slate-200 p-3">
        <Field label={kind === "PICKUP" ? "Released by (shipper / auction)" : "Received by"}>
          <input className="field" value={signer} onChange={(e) => setSigner(e.target.value)} />
        </Field>
        <SignaturePad ref={sig} />
      </div>
      {kind === "DELIVERY" && (
        <Notice>
          Damage not on the pickup report opens a damage exception automatically. <Badge tone="amber">Customer will see it</Badge>
        </Notice>
      )}
      <FormStatus error={error} ok={ok} />
      <button className={buttonClass("primary")} disabled={pending}>
        {pending ? "Uploading…" : `Save ${kind === "PICKUP" ? "pickup" : "delivery"} report`}
      </button>
    </form>
  );
}
