import { NextRequest } from 'next/server';

import { analyticsVisitors } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, analyticsVisitors, coerceQuery(request.nextUrl.searchParams));
}
