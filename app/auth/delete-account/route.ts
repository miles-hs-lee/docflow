import { NextResponse } from 'next/server';

import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

function redirectToSettings(requestUrl: string, key: 'error' | 'success', message: string) {
  const url = new URL('/dashboard/settings', requestUrl);
  url.searchParams.set(key, message);
  return NextResponse.redirect(url, { status: 303 });
}

/**
 * Hard-delete the current user's account and every owned record.
 *
 * Sequence:
 *   1. Re-verify the user is logged in and re-authenticate with the
 *      typed password (signInWithPassword with their own email). This
 *      blocks anyone who happens to have a stolen session cookie from
 *      one-clicking the destruction.
 *   2. Best-effort wipe of all PDF blobs the user uploaded. Failures
 *      are queued in pending_storage_deletions for the orphan sweep.
 *   3. supabase.auth.admin.deleteUser(user.id). Every owner_id-keyed
 *      table in the public schema has FK ON DELETE CASCADE on
 *      auth.users(id), so the actual cleanup of files / collections /
 *      share_links / link_events / mcp_api_keys / automation_subscriptions
 *      happens automatically.
 *   4. Sign the (now-deleted) session out + redirect to /login.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.redirect(new URL('/login', request.url), { status: 303 });
  }

  const formData = await request.formData();
  const password = ((formData.get('password') as string | null) || '').trim();
  if (!password) {
    return redirectToSettings(request.url, 'error', '비밀번호를 입력해주세요.');
  }

  // Re-auth check. Uses signInWithPassword on the user's own email; if
  // the password is wrong we get an error and bail before touching data.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password
  });
  if (reauthError) {
    return redirectToSettings(request.url, 'error', '비밀번호가 일치하지 않습니다.');
  }

  const admin = createAdminClient();

  // Best-effort PDF cleanup before the auth row goes away. We collect
  // every storage_path the user owns, then delete them in one batch
  // call. Anything that fails is queued for the orphan sweep so the
  // bucket doesn't leak the user's files after their account is gone.
  try {
    const { data: files } = await admin
      .from('files')
      .select('storage_path')
      .eq('owner_id', user.id);
    const paths = (files ?? [])
      .map((f) => (f as { storage_path: string }).storage_path)
      .filter((p): p is string => Boolean(p));

    if (paths.length > 0) {
      const { error: storageError } = await admin.storage.from('pdf-files').remove(paths);
      if (storageError) {
        // Queue every path; the bulk remove is all-or-nothing per Supabase API
        // semantics, so a single failure means none were deleted.
        await admin.from('pending_storage_deletions').insert(
          paths.map((p) => ({
            storage_path: p,
            reason: `account_delete: ${storageError.message}`
          }))
        );
        console.error('[deleteAccount] storage bulk remove failed', {
          ownerId: user.id,
          count: paths.length,
          reason: storageError.message
        });
      }
    }
  } catch (err) {
    // Even the file listing failed — log and proceed. The auth user
    // delete below still cascades the DB rows; storage orphans are
    // recoverable via the sweep job.
    console.error('[deleteAccount] storage prep failed', {
      ownerId: user.id,
      err: err instanceof Error ? err.message : 'unknown_error'
    });
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[deleteAccount] admin.deleteUser failed', {
      ownerId: user.id,
      reason: deleteError.message
    });
    return redirectToSettings(request.url, 'error', '계정 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  // Wipe the local session cookies (the user is gone — supabase will
  // refuse the session anyway, but this clears the browser state).
  await supabase.auth.signOut();

  const url = new URL('/login', request.url);
  url.searchParams.set('success', '계정과 모든 데이터가 영구적으로 삭제되었습니다.');
  return NextResponse.redirect(url, { status: 303 });
}
