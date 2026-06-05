import type { CSSProperties } from 'react';

import type { ViewerBranding } from '@/lib/types';

// Validate/normalize a brand-color form value (shared by the account + per-room
// save actions). Empty → null (no color); a valid #RRGGBB (with or without the
// leading #) → lowercased '#rrggbb'; anything else → invalid:true.
export function normalizeBrandColor(raw: string): { color: string | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { color: null, invalid: false };
  const normalized = (trimmed.startsWith('#') ? trimmed : `#${trimmed}`).toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return { color: null, invalid: true };
  return { color: normalized, invalid: false };
}

// Field-level merge: a data room's branding overrides the account's PER FIELD,
// inheriting any field the room left unset. Returns null when neither has any.
export function mergeBranding(
  room: ViewerBranding | null,
  account: ViewerBranding | null
): ViewerBranding | null {
  if (!room) return account;
  if (!account) return room;
  const merged: ViewerBranding = {
    company_name: room.company_name ?? account.company_name,
    brand_color: room.brand_color ?? account.brand_color,
    logo_url: room.logo_url ?? account.logo_url
  };
  if (!merged.company_name && !merged.brand_color && !merged.logo_url) return null;
  return merged;
}

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
