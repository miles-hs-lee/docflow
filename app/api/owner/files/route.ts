import { NextRequest, NextResponse } from 'next/server';

import { getCurrentWorkspace, getOwner } from '@/lib/auth';
import { listFiles, type FilesSortDir, type FilesSortKey } from '@/lib/data';

const SORT_KEYS: ReadonlyArray<FilesSortKey> = ['created_at', 'original_name', 'size_bytes'];
const SORT_DIRS: ReadonlyArray<FilesSortDir> = ['asc', 'desc'];

export async function GET(request: NextRequest) {
  const { user, supabase } = await getOwner();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const workspace = await getCurrentWorkspace(user.id);
  if (!workspace) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const search = params.get('q') ?? undefined;
  const limit = Number(params.get('limit') ?? '');
  const offset = Number(params.get('offset') ?? '');
  const sortKeyParam = (params.get('sort') ?? '') as FilesSortKey;
  const sortDirParam = (params.get('dir') ?? '') as FilesSortDir;
  const sortKey = SORT_KEYS.includes(sortKeyParam) ? sortKeyParam : undefined;
  const sortDir = SORT_DIRS.includes(sortDirParam) ? sortDirParam : undefined;

  try {
    const result = await listFiles(supabase, workspace.id, {
      search,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
      offset: Number.isFinite(offset) && offset >= 0 ? offset : undefined,
      sortKey,
      sortDir
    });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
