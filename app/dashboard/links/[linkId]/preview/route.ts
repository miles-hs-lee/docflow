import { NextResponse } from 'next/server';

import { requireWorkspace } from '@/lib/auth';
import { createLinkPreviewToken } from '@/lib/preview-token';
import { createAdminClient } from '@/lib/supabase/admin';

type RouteContext = {
  params: Promise<{ linkId: string }>;
};

// Owner preview: mint a short-lived signed token for THIS link and bounce to
// the public viewer with it. The viewer + document/event/download routes
// treat a valid token as "render like a viewer, but bypass the gates and
// never touch policy counters or analytics". Auth (workspace membership over
// the link) happens HERE — the token itself is the proof downstream.
export async function GET(_request: Request, context: RouteContext) {
  const { linkId } = await context.params;
  const { workspace } = await requireWorkspace();

  const admin = createAdminClient();
  const { data: link } = await admin
    .from('share_links')
    .select('id, token')
    .eq('id', linkId)
    .eq('workspace_id', workspace.id)
    .maybeSingle();

  if (!link) {
    return NextResponse.redirect(
      new URL(`/dashboard?error=${encodeURIComponent('링크를 찾을 수 없습니다.')}`, _request.url)
    );
  }

  const previewToken = createLinkPreviewToken(link.id);
  return NextResponse.redirect(
    new URL(`/v/${link.token}?preview=${encodeURIComponent(previewToken)}`, _request.url)
  );
}
