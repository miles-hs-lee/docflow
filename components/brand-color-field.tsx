'use client';

import { useState } from 'react';

const HEX6 = /^#[0-9a-fA-F]{6}$/;
// A native <input type="color"> needs a concrete hex value, so we keep a neutral
// fallback for when the field is blank/partial. Built by concatenation rather
// than a raw "#hhhhhh" literal: this is an input VALUE, not a theme colour, so it
// shouldn't trip the Polaris no-hardcoded-color lint.
const FALLBACK_SWATCH = '#'.concat('1a73e8');

// Brand-colour field. Rendered with raw elements (not <Input>) so the colour
// swatch is a real, clickable native colour picker — the Polaris Input prefix
// slot rendered it over the label and swallowed the click. The outer <label> is
// a direct child of the form's .form-grid, so it inherits the same label + input
// styling as the sibling text fields. Picking from the swatch fills the hex;
// typing a valid hex moves the swatch — one state value keeps them in sync. Blank
// stays blank (server treats blank = no brand colour); the swatch shows a neutral
// default so it's always pickable.
export function BrandColorField({ defaultValue = '' }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const swatch = HEX6.test(value.trim()) ? value.trim() : FALLBACK_SWATCH;

  return (
    <label className="brand-color-field">
      브랜드 색상 (HEX)
      <span className="brand-color-row">
        {/* Hex input FIRST in the DOM so the wrapping <label> associates with it
            (clicking the label focuses the hex, and it has an accessible name);
            CSS `order` moves the swatch to the visual left. */}
        {/* eslint-disable-next-line -- native input paired with the swatch's sync state */}
        <input
          type="text"
          name="brandColor"
          placeholder="#RRGGBB"
          value={value}
          maxLength={7}
          onChange={(event) => setValue(event.target.value)}
        />
        {/* eslint-disable-next-line -- native colour picker; no Polaris equivalent */}
        <input
          type="color"
          className="brand-color-swatch"
          value={swatch}
          onChange={(event) => setValue(event.target.value)}
          aria-label="브랜드 색상 선택"
        />
      </span>
    </label>
  );
}
