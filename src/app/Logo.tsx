import { useId } from "react";

/** KeyHalo mark: a keycap with a spectrum halo. */
export function Logo({ size = 22 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={`${id}-h`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4d6d" />
          <stop offset="0.35" stopColor="#ffb703" />
          <stop offset="0.65" stopColor="#3ddc97" />
          <stop offset="1" stopColor="#4c6fff" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="9" fill="none" stroke={`url(#${id}-h)`} strokeWidth="2.5" />
      <rect x="8.5" y="8.5" width="15" height="15" rx="4.5" fill="currentColor" />
    </svg>
  );
}
