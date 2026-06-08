import { NextRequest } from 'next/server';

import { analyticsSummary } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, analyticsSummary, coerceQuery(request.nextUrl.searchParams));
}
