import { NextRequest } from 'next/server';

import { analyticsPages } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, analyticsPages, coerceQuery(request.nextUrl.searchParams));
}
