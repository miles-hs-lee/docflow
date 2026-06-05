import { NextResponse } from 'next/server';

import { handleLogoUpload } from '@/lib/logo-upload';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 30;

// Owner-only account logo upload → owner_branding.logo_path. Manual auth so an
// unauthenticated fetch gets a 401 JSON instead of a redirect-to-login.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  return handleLogoUpload({
    request,
    pathPrefix: `${user.id}/logo-`,
    loadOldPath: async () => {
      const { data } = await admin.from('owner_branding').select('logo_path').eq('owner_id', user.id).maybeSingle();
      return (data as { logo_path: string | null } | null)?.logo_path ?? null;
    },
    persist: async (path) => {
      const { error } = await admin
        .from('owner_branding')
        .upsert({ owner_id: user.id, logo_path: path }, { onConflict: 'owner_id' });
      return { error };
    }
  });
}
