import { NextResponse } from 'next/server';

import { requireOwner } from '@/lib/auth';
import { getLink } from '@/lib/data';
import type { LinkEventRow } from '@/lib/types';

type RouteContext = {
  params: Promise<{ linkId: string }>;
};

// Full event-log export (review finding #6). The dashboard log is cursor-
// paginated to 100/page; this streams the whole history as CSV. Owner-only:
// requireOwner gates auth, getLink runs under the RLS-scoped client so a
// foreign linkId resolves to null → 404. Capped to avoid unbounded memory.
const EXPORT_CAP = 10000;

const COLUMNS = [
  'id',
  'created_at_utc',
  'event_type',
  'reason',
  'page_number',
  'dwell_ms',
  'viewer_email',
  'session_id'
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  // CSV formula-injection guard: a cell that starts with = + - @ (or a
  // tab/CR that lets a leading formula char slip in) is executed as a formula
  // by Excel/Sheets. We export viewer-controlled values (viewer_email, etc.)
  // with a UTF-8 BOM for Excel, so neutralize by prefixing a single quote.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(_request: Request, context: RouteContext) {
  const { linkId } = await context.params;
  const { supabase } = await requireOwner();

  const link = await getLink(supabase, linkId);
  if (!link) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('link_events')
    .select('id, event_type, reason, page_number, dwell_ms, viewer_email, session_id, created_at')
    .eq('link_id', link.id)
    .order('id', { ascending: true })
    .limit(EXPORT_CAP);

  if (error) {
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }

  const rows = (data ?? []) as Array<
    Pick<LinkEventRow, 'id' | 'event_type' | 'reason' | 'page_number' | 'dwell_ms' | 'viewer_email' | 'session_id' | 'created_at'>
  >;

  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.id),
        csvCell(row.created_at),
        csvCell(row.event_type),
        csvCell(row.reason),
        csvCell(row.page_number),
        csvCell(row.dwell_ms),
        csvCell(row.viewer_email),
        csvCell(row.session_id)
      ].join(',')
    );
  }
  // Prepend a UTF-8 BOM so Excel reads Korean/UTF-8 cells correctly.
  const body = '﻿' + lines.join('\r\n') + '\r\n';

  const safeLabel = (link.label || 'events').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 40) || 'events';

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeLabel}-events.csv"`,
      'Cache-Control': 'no-store'
    }
  });
}
