import { NextResponse } from 'next/server';

import { handleLogoUpload } from '@/lib/logo-upload';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

// Owner-only per-data-room cover-image upload → collection_branding.cover_image_path.
// Reuses the public owner-logos bucket (path prefix room-${collectionId}-cover-).
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
    field: 'cover',
    pathPrefix: `${user.id}/room-${collectionId}-cover-`,
    loadOldPath: async () => {
      const { data } = await admin
        .from('collection_branding')
        .select('cover_image_path')
        .eq('collection_id', collectionId)
        .maybeSingle();
      return (data as { cover_image_path: string | null } | null)?.cover_image_path ?? null;
    },
    persist: async (path) => {
      const { error } = await admin
        .from('collection_branding')
        .upsert(
          { collection_id: collectionId, owner_id: user.id, cover_image_path: path },
          { onConflict: 'collection_id' }
        );
      return { error };
    }
  });
}
