import { NextRequest } from 'next/server';

import { contactsList } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, contactsList, coerceQuery(request.nextUrl.searchParams));
}
