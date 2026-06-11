import { NextRequest } from 'next/server';

import { collectionsDelete, collectionsGet, collectionsUpdate } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return runRestOperation(request, collectionsGet, { collectionId });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return runRestOperation(request, collectionsUpdate, { ...body, collectionId });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;
  return runRestOperation(request, collectionsDelete, { collectionId });
}
