import { NextRequest } from 'next/server';

import { linksRestore } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function POST(request: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  return runRestOperation(request, linksRestore, { linkId });
}
