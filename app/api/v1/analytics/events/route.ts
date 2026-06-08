import { NextRequest } from 'next/server';

import { analyticsEvents } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, analyticsEvents, coerceQuery(request.nextUrl.searchParams));
}
