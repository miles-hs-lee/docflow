import { NextRequest } from 'next/server';

import { linksCreate, linksList } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, linksList, coerceQuery(request.nextUrl.searchParams));
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return runRestOperation(request, linksCreate, body);
}
