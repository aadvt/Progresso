import type { SVGProps } from "react";

const PATHS = {
  arrowRight: "M5 12h14M13 6l6 6-6 6",
  arrowLeft: "M19 12H5M11 6l-6 6 6 6",
  chevronDown: "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6L6 18",
  check: "M5 12.5l4.5 4.5L19 7",
  doc: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  upload: "M12 16V4M7 9l5-5 5 5M4 16v4h16v-4",
  paste: "M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  calendar: "M4 6h16v15H4zM4 10h16M8 3v4M16 3v4",
  quote: "M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01",
  compass: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
  rocket: "M5 15c-1 1-1.5 3.5-1.5 5.5 2 0 4.5-.5 5.5-1.5M9 15l-3-3 3-5c2.5-3.5 6.5-4.5 11-4-.5 4.5-1.5 8.5-5 11l-5 3zM14.5 9.5h.01",
  alert: "M12 3l10 18H2zM12 10v5M12 18h.01",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  play: "M8 5v14l11-7z",
  pause: "M8 5v14M16 5v14",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  map: "M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14",
  list: "M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6L6 6M18 18l1.4 1.4M4.6 19.4L6 18M18 6l1.4-1.4",
} as const;

export type IconName = keyof typeof PATHS;

/** Line icons on a 24px grid, 1.75px stroke. Decorative unless given a label. */
export function Icon({ name, size = 20, label, ...rest }: { name: IconName; size?: number; label?: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
