import { NextRequest } from 'next/server';

import { questionsList } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, questionsList, coerceQuery(request.nextUrl.searchParams));
}
