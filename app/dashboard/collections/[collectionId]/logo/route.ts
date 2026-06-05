import { NextResponse } from 'next/server';

import { handleLogoUpload } from '@/lib/logo-upload';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

// Owner-only per-data-room logo upload → collection_branding.logo_path. Reuses
// the public owner-logos bucket (path prefixed room-${collectionId}-).
export async function POST(request: Request, { params }: { params: Promise<{ collectionId: string }> }) {
  const { collectionId } = await params;

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const { data: owned } = await admin
    .from('collections')
    .select('id')
    .eq('id', collectionId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (!owned) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  return handleLogoUpload({
    request,
    pathPrefix: `${user.id}/room-${collectionId}-`,
    loadOldPath: async () => {
      const { data } = await admin
        .from('collection_branding')
        .select('logo_path')
        .eq('collection_id', collectionId)
        .maybeSingle();
      return (data as { logo_path: string | null } | null)?.logo_path ?? null;
    },
    persist: async (path) => {
      const { error } = await admin
        .from('collection_branding')
        .upsert({ collection_id: collectionId, owner_id: user.id, logo_path: path }, { onConflict: 'collection_id' });
      return { error };
    }
  });
}
