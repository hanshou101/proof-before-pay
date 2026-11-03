import type { SVGProps } from 'react';

/** 20px ink rounded square with a white check — header mark and favicon asset. */
export function Logo({ size = 20, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Proof Before Pay"
      {...rest}
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M9.5 16.6l4.2 4.2 8.8-9.6"
        fill="none"
        stroke="var(--surface)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
