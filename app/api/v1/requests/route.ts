import { NextRequest } from 'next/server';

import { requestsList } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, requestsList, coerceQuery(request.nextUrl.searchParams));
}
