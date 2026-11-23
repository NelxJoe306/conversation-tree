"use client";
import { useRef } from "react";

export function ResizeDivider({
  side,
  value,
  min,
  max,
  onChange,
  onDragging,
  label,
  resetValue,
}: {
  label: string;
  resetValue: number;
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  onDragging: (value: boolean) => void;
}) {
  const start = useRef<{ pointerId: number; x: number; width: number } | null>(
    null,
  );
  const clamp = (width: number) =>
    Math.round(Math.max(min, Math.min(max, width)));
  function finish() {
    start.current = null;
    onDragging(false);
  }
  return (
    <div
      className={`resize-divider resize-${side}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        start.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          width: value,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        onDragging(true);
      }}
      onPointerMove={(event) => {
        const active = start.current;
        if (!active || active.pointerId !== event.pointerId) return;
        onChange(
          clamp(
            active.width +
              (event.clientX - active.x) * (side === "left" ? 1 : -1),
          ),
        );
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
          return;
        event.preventDefault();
        const direction =
          (event.key === "ArrowRight" ? 1 : -1) * (side === "left" ? 1 : -1);
        onChange(
          event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : clamp(value + direction * (event.shiftKey ? 32 : 8)),
        );
      }}
      onDoubleClick={() => onChange(clamp(resetValue))}
    />
  );
}
