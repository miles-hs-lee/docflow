import { NextRequest } from 'next/server';

import { collectionsList } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, collectionsList, coerceQuery(request.nextUrl.searchParams));
}
