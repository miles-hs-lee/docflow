'use client';

import { DatePicker, HStack, VStack } from '@polaris/ui';
import { useState } from 'react';

type ExpiryDateFieldProps = {
  /** Hidden input name posted to the server action. */
  name: string;
  label?: string;
  /** Existing expires_at ISO string (edit form). */
  defaultValue?: string | null;
};

// Wrapper around Polaris DatePicker for the share-link "expires at" field.
// DatePicker is a controlled, button-style trigger (no `name` prop), so we
// hold the picked Date in state and mirror it through a hidden input that
// the server action reads via `parseOptionalDate(formData, 'expiresAt')`.
//
// "만료" semantically = "valid through end of selected day", so we
// serialize the local end-of-day (23:59:59.999) — converted to UTC by
// toISOString() — instead of midnight at the start of the day.
export function ExpiryDateField({ name, label = '만료일', defaultValue }: ExpiryDateFieldProps) {
  const [date, setDate] = useState<Date | undefined>(
    defaultValue ? new Date(defaultValue) : undefined
  );

  const submittedValue = date ? endOfLocalDay(date).toISOString() : '';

  return (
    <VStack gap={2}>
      <span className="expiry-date-label">{label}</span>
      <HStack align="center" gap={2}>
        <DatePicker
          value={date}
          onChange={setDate}
          placeholder="날짜 선택"
          ariaLabel={label}
        />
        {date ? (
          <button
            type="button"
            className="link-button"
            onClick={() => setDate(undefined)}
            aria-label={`${label} 지우기`}
          >
            지우기
          </button>
        ) : null}
      </HStack>
      <input type="hidden" name={name} value={submittedValue} />
    </VStack>
  );
}

function endOfLocalDay(d: Date) {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}
