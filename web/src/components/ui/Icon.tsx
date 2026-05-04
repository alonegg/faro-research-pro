/** Inline SVG icon set. Tiny stroke-based glyphs, all 24×24 viewBox.
 *  Pass `size` prop (default 14) and any other svg props. */

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

const sw = (size: number) => 1.6 * (16 / size); // visually consistent stroke

function base(size: number, extra: React.SVGProps<SVGSVGElement> = {}) {
  return {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: "currentColor",
    strokeWidth: sw(size), strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
    ...extra,
  };
}

export const I = {
  Brain: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M9 5a3 3 0 0 0-3 3v.5A3 3 0 0 0 5 14a3 3 0 0 0 1 5.5A2.5 2.5 0 0 0 9 22V5Z"/><path d="M15 5a3 3 0 0 1 3 3v.5A3 3 0 0 1 19 14a3 3 0 0 1-1 5.5A2.5 2.5 0 0 1 15 22V5Z"/></svg>
  ),
  Eye: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
  ),
  Layers: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>
  ),
  Pin: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M12 17v5"/><path d="M9 10.76V8c0-.55.45-1 1-1h4c.55 0 1 .45 1 1v2.76l3 3V17H6v-3.24l3-3Z"/></svg>
  ),
  Trash: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M3 6h18"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/></svg>
  ),
  Hash: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
  ),
  Send: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="m22 2-11 11"/></svg>
  ),
  Search: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
  ),
  Plus: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
  ),
  Compass: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" stroke="none"/></svg>
  ),
  Check: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><polyline points="20 6 9 17 4 12"/></svg>
  ),
  ChevDown: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><polyline points="6 9 12 15 18 9"/></svg>
  ),
  ChevRight: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><polyline points="9 18 15 12 9 6"/></svg>
  ),
  Bolt: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none"/></svg>
  ),
  Tools: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>
  ),
  Database: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5"/><path d="M3 12c0 1.7 4 3 9 3s9-1.3 9-3"/></svg>
  ),
  Copy: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
  ),
  Download: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
  ),
  Share: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
  ),
  Activity: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  ),
  Sparkle: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/></svg>
  ),
  Sidebar: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
  ),
  Close: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  ),
  Settings: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>
  ),
  Quote: ({ size = 14, ...rest }: IconProps) => (
    <svg {...base(size, rest)}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h2c1 0 1 1 1 2v1c0 1-1 2-2 2H3v3Z"/><path d="M14 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h2c1 0 1 1 1 2v1c0 1-1 2-2 2h-1v3Z"/></svg>
  ),
};
