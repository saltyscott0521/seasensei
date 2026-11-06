// Motion tokens (overhaul spec). Animate opacity/transform only; <MotionConfig reducedMotion="user"> in main.tsx
// drops translate/scale/rotate for people who ask for less motion. CSS mirrors: --dur-fast/base/slow, ease-ui.
import { useState } from "react";

/** Durations in seconds. */
export const duration = { fast: 0.12, base: 0.2, slow: 0.32 } as const;

/** The one spring for UI movement. */
export const spring = { type: "spring", stiffness: 520, damping: 42, mass: 0.9 } as const;

/** Ease-out curve for tweens. */
export const ease = [0.2, 0.8, 0.2, 1] as const;

/**
 * Critically damped spring for rotations (compass needle, arrows): damping ratio ≈ 1.01, so it never swings past
 * the real direction; a half-turn settles within 1° in about half a second.
 * @example <motion.div animate={{ rotate: useUnwrappedAngle(dir) }} transition={turn} />
 */
export const turn = { type: "spring", stiffness: 300, damping: 35, mass: 1 } as const;

/** Delay for the i-th item of a staggered entrance: 30 ms apart, capped at 6 items. */
export const stagger = (i: number) => Math.min(Math.max(i, 0), 5) * 0.03;

/** The shortest signed turn from `from` to `to` in degrees, in [-180, 180): 350 → 10 is +20, not −340. */
export const shortestTurn = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/**
 * Unwraps a compass angle against its previous value so a rotation always takes the short way round.
 * Returns an angle equal to `deg` (mod 360) within 180° of the last one returned: 350° then 10° gives 350 then 370.
 * Non-finite input keeps the last angle. Use it for anything you animate with `rotate`.
 * @example const rot = useUnwrappedAngle(dir); <svg style={{ transform: `rotate(${rot + 180}deg)` }} />
 */
export function useUnwrappedAngle(deg: number) {
  const [s, setS] = useState(() => ({ raw: deg, acc: Number.isFinite(deg) ? deg : 0 }));
  if (Number.isFinite(deg) && deg !== s.raw) {
    // Adjusting state while rendering (React re-renders this component straight away, before children).
    const next = { raw: deg, acc: Number.isFinite(s.raw) ? s.acc + shortestTurn(s.raw, deg) : deg };
    setS(next);
    return next.acc;
  }
  return s.acc;
}
