import { NextRequest } from 'next/server';

import { questionsAnswer } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return runRestOperation(request, questionsAnswer, { ...body, questionId });
}
