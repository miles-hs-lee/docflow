'use client';

import { DatePicker } from '@polaris/ui';
import { useState } from 'react';

type ExpiryDateFieldProps = {
  /** Hidden input name posted to the server action. Defaults to "expiresAt". */
  name?: string;
  /** Existing expires_at ISO string (edit form). */
  defaultValue?: string | null;
};

// v0.8: DatePicker now supports `name` + `valueFormat` so the hidden
// form-input is built in. This wrapper exists only to seed `value` on
// the edit form (Polaris doesn't expose `defaultValue`); for create
// forms you could equivalently render <DatePicker> inline. We keep the
// wrapper for one consistent callsite + the end-of-day valueFormat.
//
// "만료" semantically = "valid through end of selected day", so the
// hidden input formats as `yyyy-MM-dd'T23:59:59'` — server action's
// new Date(raw).toISOString() then produces a sensible UTC ISO.
export function ExpiryDateField({ name = 'expiresAt', defaultValue }: ExpiryDateFieldProps) {
  const [date, setDate] = useState<Date | undefined>(
    defaultValue ? new Date(defaultValue) : undefined
  );

  return (
    <DatePicker
      name={name}
      value={date}
      onChange={setDate}
      valueFormat="yyyy-MM-dd'T23:59:59'"
      placeholder="만료일 (선택)"
      ariaLabel="만료일"
      className="expiry-date-picker"
    />
  );
}
