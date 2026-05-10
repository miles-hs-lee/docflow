'use client';

import { DatePicker } from '@polaris/ui';
import { useState } from 'react';

type ExpiryDateFieldProps = {
  /** Hidden input name posted to the server action. */
  name: string;
  /** Existing expires_at ISO string (edit form). */
  defaultValue?: string | null;
};

// Wrapper around Polaris DatePicker for the share-link "expires at"
// field. DatePicker is a controlled, button-style trigger (no `name`
// prop), so we hold the picked Date in state and mirror it through a
// hidden input that the server action's parseOptionalDate(...) reads.
//
// "만료" semantically = "valid through end of selected day", so the
// serialized value is local end-of-day (23:59:59.999) → toISOString().
//
// Visual: the DatePicker is forced to fill its grid column (w-full +
// h-13 to match Input's 52px) and uses its `placeholder` as the
// in-button label so it visually pairs with sibling Inputs that use the
// floating-label-inside-the-box pattern. No external label needed —
// `aria-label` covers AT.
export function ExpiryDateField({ name, defaultValue }: ExpiryDateFieldProps) {
  const [date, setDate] = useState<Date | undefined>(
    defaultValue ? new Date(defaultValue) : undefined
  );

  const submittedValue = date ? endOfLocalDay(date).toISOString() : '';

  return (
    <div className="expiry-date-field">
      <DatePicker
        value={date}
        onChange={setDate}
        placeholder="만료일 (선택)"
        ariaLabel="만료일"
        className="expiry-date-picker"
      />
      {date ? (
        <button
          type="button"
          className="expiry-date-clear"
          onClick={() => setDate(undefined)}
          aria-label="만료일 지우기"
          title="만료일 지우기"
        >
          ×
        </button>
      ) : null}
      <input type="hidden" name={name} value={submittedValue} />
    </div>
  );
}

function endOfLocalDay(d: Date) {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}
