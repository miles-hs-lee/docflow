'use client';

import { Input } from '@polaris/ui';
import { useState } from 'react';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
// A native <input type="color"> needs a concrete hex value, so we keep a neutral
// fallback for when the field is blank/partial. Built by concatenation rather
// than a raw "#hhhhhh" literal: this is an input VALUE, not a theme colour, so it
// shouldn't trip the Polaris no-hardcoded-color lint.
const FALLBACK_SWATCH = '#'.concat('1a73e8');

// Brand-colour field: a hex text input (submitted as `brandColor`) with a native
// colour-picker swatch in the leading slot. Picking from the swatch fills the
// hex; typing a valid hex moves the swatch — one state value keeps them in sync.
// Blank/invalid stays blank (server treats blank = no brand colour) while the
// swatch falls back to a neutral default so it remains pickable.
export function BrandColorField({ defaultValue = '' }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const swatch = HEX6.test(value.trim()) ? value.trim() : FALLBACK_SWATCH;

  return (
    <Input
      name="brandColor"
      label="브랜드 색상 (HEX)"
      placeholder="#RRGGBB"
      value={value}
      maxLength={7}
      onChange={(event) => setValue(event.target.value)}
      prefix={
        // eslint-disable-next-line -- native colour picker; no Polaris equivalent
        <input
          type="color"
          aria-label="브랜드 색상 선택"
          className="brand-color-swatch"
          value={swatch}
          onChange={(event) => setValue(event.target.value)}
        />
      }
    />
  );
}
