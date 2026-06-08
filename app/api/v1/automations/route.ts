import { NextRequest } from 'next/server';

import { automationsList, automationsSubscribe } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, automationsList, coerceQuery(request.nextUrl.searchParams));
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return runRestOperation(request, automationsSubscribe, body);
}
