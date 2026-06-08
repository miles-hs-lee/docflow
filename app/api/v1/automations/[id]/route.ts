import { NextRequest } from 'next/server';

import { automationsUnsubscribe } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return runRestOperation(request, automationsUnsubscribe, { subscriptionId: id });
}
