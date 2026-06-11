import { NextRequest } from 'next/server';

import { workspaceInfo } from '@/lib/api/operations';
import { runRestOperation } from '@/lib/api/rest';

export async function GET(request: NextRequest) {
  return runRestOperation(request, workspaceInfo, {});
}
