import { NextRequest } from 'next/server';

import { linksUpdate } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return runRestOperation(request, linksUpdate, { ...body, linkId });
}
