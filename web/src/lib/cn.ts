/** Tiny clsx-like helper. We don't use Tailwind, so no need for tailwind-merge. */
export function cn(...xs: (string | false | null | undefined)[]): string {
  return xs.filter(Boolean).join(" ");
}
