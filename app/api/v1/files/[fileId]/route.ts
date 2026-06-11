import { NextRequest } from 'next/server';

import { filesDelete, filesGet } from '@/lib/api/operations';
import { coerceQuery, runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  return runRestOperation(request, filesGet, { ...coerceQuery(request.nextUrl.searchParams), fileId });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await params;
  return runRestOperation(request, filesDelete, { fileId });
}
