import { NextRequest } from 'next/server';

import { requestUploadsList } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  return runRestOperation(request, requestUploadsList, { requestId });
}
