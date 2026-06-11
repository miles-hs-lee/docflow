import { NextRequest } from 'next/server';

import { analyticsDaily } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, analyticsDaily, coerceQuery(request.nextUrl.searchParams));
}
