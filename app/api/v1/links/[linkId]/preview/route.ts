import { NextRequest } from 'next/server';

import { linksPreview } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  return runRestOperation(request, linksPreview, { linkId });
}
