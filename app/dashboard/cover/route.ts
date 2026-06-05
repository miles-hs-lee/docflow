import { NextResponse } from 'next/server';

import { handleLogoUpload } from '@/lib/logo-upload';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

// Owner-only account cover-image upload → owner_branding.cover_image_path.
// Reuses the public owner-logos bucket (path prefix `${user.id}/cover-`).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  return handleLogoUpload({
    request,
    field: 'cover',
    pathPrefix: `${user.id}/cover-`,
    loadOldPath: async () => {
      const { data } = await admin
        .from('owner_branding')
        .select('cover_image_path')
        .eq('owner_id', user.id)
        .maybeSingle();
      return (data as { cover_image_path: string | null } | null)?.cover_image_path ?? null;
    },
    persist: async (path) => {
      const { error } = await admin
        .from('owner_branding')
        .upsert({ owner_id: user.id, cover_image_path: path }, { onConflict: 'owner_id' });
      return { error };
    }
  });
}
