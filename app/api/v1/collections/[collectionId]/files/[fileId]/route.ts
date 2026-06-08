import { NextRequest } from 'next/server';

import { collectionsRemoveFile } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ collectionId: string; fileId: string }> }
) {
  const { collectionId, fileId } = await params;
  return runRestOperation(request, collectionsRemoveFile, { collectionId, fileId });
}
