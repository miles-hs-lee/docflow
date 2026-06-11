import { NextRequest } from 'next/server';

import { linksDelete, linksGet, linksHardDelete, linksUpdate } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  return runRestOperation(request, linksGet, { linkId });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return runRestOperation(request, linksUpdate, { ...body, linkId });
}

// DELETE = trash (recoverable via POST /links/{id}/restore).
// DELETE ?permanent=true = destroy a link that is ALREADY trashed.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const permanent = request.nextUrl.searchParams.get('permanent') === 'true';
  return runRestOperation(request, permanent ? linksHardDelete : linksDelete, { linkId });
}
