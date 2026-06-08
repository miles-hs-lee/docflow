import { NextRequest } from 'next/server';

import { collectionsAddFiles } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function POST(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return runRestOperation(request, collectionsAddFiles, { ...body, collectionId });
}
