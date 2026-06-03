'use client';

import { DatePicker } from '@polaris/ui';
import { useState } from 'react';

type ExpiryDateFieldProps = {
  /** Hidden input name posted to the server action. Defaults to "expiresAt". */
  name?: string;
  /** Existing expires_at ISO string (edit form). */
  defaultValue?: string | null;
};

// v0.8: DatePicker ships `name` + `valueFormat`, so the hidden form input
// is built in. This wrapper adds two things Polaris doesn't:
//
// 1. Timezone-correct end-of-day. "만료" = "valid through the END of the
//    selected day, in the OWNER's local timezone". DatePicker's selected
//    Date is local-midnight; we format it as `yyyy-MM-dd'T23:59:59'xxx`
//    where `xxx` appends the browser's UTC offset (e.g. +09:00). The
//    server's `new Date(raw).toISOString()` then resolves to the correct
//    UTC instant. WITHOUT the `xxx` offset token, the offset-less string
//    is parsed as the server's TZ (UTC on Vercel) — a ~±half-day skew
//    for every non-UTC owner.
//
// 2. A clear control. DatePicker has no built-in "×"; clearing otherwise
//    requires re-clicking the selected day in the popup (undiscoverable).
//    We surface an explicit "지우기" button when a date is set so an owner
//    can revert a link to "no expiry".
export function ExpiryDateField({ name = 'expiresAt', defaultValue }: ExpiryDateFieldProps) {
  const [date, setDate] = useState<Date | undefined>(
    defaultValue ? new Date(defaultValue) : undefined
  );

  return (
    <div className="expiry-date-field">
      <DatePicker
        name={name}
        value={date}
        onChange={setDate}
        valueFormat="yyyy-MM-dd'T23:59:59'xxx"
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
    </div>
  );
}
