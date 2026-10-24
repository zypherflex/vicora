"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

export interface SignaturePadHandle {
  toBlob: () => Promise<Blob | null>;
  isEmpty: () => boolean;
  clear: () => void;
}

/** Touch/mouse signature capture on a canvas. Exported as PNG for upload as a SIGNATURE document. */
export function SignaturePad({ ref, height = 160 }: { ref: Ref<SignaturePadHandle>; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = height * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio);
    g.lineWidth = 2;
    g.lineCap = "round";
    g.strokeStyle = "#0f172a";
  }, [height]);

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  useImperativeHandle(ref, () => ({
    isEmpty: () => empty,
    clear: () => {
      const c = canvas.current!;
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      setEmpty(true);
    },
    toBlob: () => new Promise((resolve) => (empty ? resolve(null) : canvas.current!.toBlob((b) => resolve(b), "image/png"))),
  }));

  return (
    <div>
      <canvas
        ref={canvas}
        style={{ height, touchAction: "none" }}
        className="w-full rounded-md border border-slate-300 bg-white"
        aria-label="Signature area"
        onPointerDown={(e) => {
          drawing.current = true;
          const g = canvas.current!.getContext("2d")!;
          const [x, y] = point(e);
          g.beginPath();
          g.moveTo(x, y);
          canvas.current!.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const g = canvas.current!.getContext("2d")!;
          const [x, y] = point(e);
          g.lineTo(x, y);
          g.stroke();
          setEmpty(false);
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>Sign above</span>
        <button
          type="button"
          className="underline"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
          }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
