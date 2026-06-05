import type { CSSProperties } from 'react';

// Override the Polaris accent tokens (and our --primary alias) with the owner's
// brand color so primary buttons / focus rings on the public pages adopt it.
// Returns undefined when no color is set, so the page keeps the default accent.
export function brandAccentStyle(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    '--polaris-accent-brand-normal': color,
    '--polaris-accent-brand-strong': color,
    '--primary': color
  } as CSSProperties;
}
