"use client";
import { useEffect, useRef, useState } from "react";
import { formatChips } from "../lib/poker";

export function useAnimatedAmount(value: number, reduced = false, linear = false): number {
  const [display, setDisplay] = useState(value);
  const current = useRef(value);
  useEffect(() => {
    if (reduced || current.current === value) { current.current = value; setDisplay(value); return; }
    const from = current.current;
    let frame: number;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const progress = Math.min(1, (now - start) / 300);
      const eased = linear ? progress : 1 - (1 - progress) ** 3;
      current.current = from + (value - from) * eased;
      setDisplay(Math.round(current.current));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced, linear]);
  return reduced ? value : display;
}

export function AnimatedAmount({ value, reduced = false }: { value: number; reduced?: boolean }) {
  const display = useAnimatedAmount(value, reduced);
  return <span className="animated-amount" aria-label={String(value)}>{formatChips(display)}</span>;
}
