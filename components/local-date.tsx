'use client';

import { useEffect, useState } from 'react';

import { formatDateOnly, formatDateTime } from '@/lib/format';

// Renders a timestamp without a hydration mismatch.
//
// formatDateTime/formatDateOnly use the runtime's local timezone. In a
// client component this means SSR formats in the server's TZ (UTC on
// Vercel) while hydration formats in the viewer's TZ — the text differs
// and React logs "Hydration failed … text didn't match" (#418).
//
// Fix: the first render (SSR + the pre-hydration client render) uses a
// deterministic UTC slice taken straight from the ISO string, so server
// and client agree exactly. After mount we swap to the viewer's local
// time. suppressHydrationWarning covers the post-mount swap.
//
// Server components don't need this (their output is HTML, never
// re-rendered on the client) — only use it inside `'use client'` files.
export function LocalDate({
  value,
  mode = 'datetime'
}: {
  value: string | null | undefined;
  mode?: 'datetime' | 'date';
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!value) return <>-</>;

  const text = mounted
    ? mode === 'date'
      ? formatDateOnly(value)
      : formatDateTime(value)
    : utcSlice(value, mode);

  return (
    <time dateTime={value} suppressHydrationWarning>
      {text}
    </time>
  );
}

// Deterministic UTC representation from an ISO string — identical on
// server and client (pure string ops, no Date/TZ). Falls back to the raw
// value if it isn't ISO-shaped.
function utcSlice(iso: string, mode: 'datetime' | 'date') {
  if (iso.length < 10 || iso[4] !== '-') return iso;
  const date = iso.slice(0, 10);
  if (mode === 'date' || iso.length < 16 || iso[10] !== 'T') return date;
  return `${date} ${iso.slice(11, 16)}`;
}
