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
 * Sequence (revised):
 *   1. Re-auth: signInWithPassword on the session user's own email.
 *      Stops a stolen-session one-click destruction.
 *   2. Snapshot storage paths (read-only). If this listing fails we
 *      ABORT — leaving storage orphans behind would be worse than the
 *      owner retrying after a transient DB blip.
 *   3. supabase.auth.admin.deleteUser(user.id). Every owner_id-keyed
 *      public-schema table has FK ON DELETE CASCADE on auth.users(id),
 *      so files / collections / share_links / link_events / mcp_api_keys
 *      / automation_subscriptions cascade away in one Supabase txn. If
 *      this fails the DB is still consistent and storage is untouched.
 *   4. Best-effort storage cleanup AFTER the user is gone. Failures
 *      queue into pending_storage_deletions for the orphan sweep.
 *   5. Sign the local session out + redirect to /login.
 *
 * Why storage AFTER deleteUser: if storage went first and deleteUser
 * then failed, the account would survive but its PDFs would be gone
 * — broken share links pointing at missing blobs. The reverse failure
 * mode (deleteUser succeeds, storage cleanup fails) leaves orphans
 * that the sweep job recovers, with no broken-link surface.
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

  // Re-auth check. signInWithPassword on the user's own email; wrong
  // password ⇒ bail before touching anything.
  const { error: reauthError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password
  });
  if (reauthError) {
    return redirectToSettings(request.url, 'error', '비밀번호가 일치하지 않습니다.');
  }

  const admin = createAdminClient();

  // 1) Snapshot storage paths BEFORE we delete the auth user. If the
  // listing itself fails we abort — proceeding would leak the orphan
  // paths since we'd no longer be able to recover them after cascade.
  let paths: string[] = [];
  try {
    const { data: files, error: listError } = await admin
      .from('files')
      .select('storage_path')
      .eq('owner_id', user.id);
    if (listError) throw listError;
    paths = (files ?? [])
      .map((f) => (f as { storage_path: string }).storage_path)
      .filter((p): p is string => Boolean(p));
  } catch (err) {
    console.error('[deleteAccount] storage listing failed — aborting', {
      ownerId: user.id,
      err: err instanceof Error ? err.message : 'unknown_error'
    });
    return redirectToSettings(
      request.url,
      'error',
      '계정 삭제 준비 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
    );
  }

  // 2) Delete the auth user (and cascade-clean every owner_id row).
  // Storage is still intact at this point — if deleteUser fails we
  // surface the error and the data is unchanged.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error('[deleteAccount] admin.deleteUser failed', {
      ownerId: user.id,
      reason: deleteError.message
    });
    return redirectToSettings(request.url, 'error', '계정 삭제에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  // 3) Best-effort storage cleanup AFTER the user is gone. Anything
  // that fails — whether storage.remove returns a normal error or
  // throws — goes into pending_storage_deletions for the sweep job.
  // Both branches must queue, otherwise an unexpected throw would
  // leave untracked PDF orphans in the bucket after the account is
  // already gone.
  if (paths.length > 0) {
    const queueOrphans = async (reason: string) => {
      try {
        await admin.from('pending_storage_deletions').insert(
          paths.map((p) => ({
            storage_path: p,
            reason: `account_delete: ${reason}`
          }))
        );
      } catch (queueErr) {
        console.error('[deleteAccount] failed to queue storage cleanup', {
          ownerId: user.id,
          count: paths.length,
          queueErr: queueErr instanceof Error ? queueErr.message : 'unknown_error'
        });
      }
    };

    try {
      const { error: storageError } = await admin.storage.from('pdf-files').remove(paths);
      if (storageError) {
        console.error('[deleteAccount] storage bulk remove failed', {
          ownerId: user.id,
          count: paths.length,
          reason: storageError.message
        });
        await queueOrphans(storageError.message);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown_throw';
      console.error('[deleteAccount] storage cleanup threw', {
        ownerId: user.id,
        count: paths.length,
        reason
      });
      await queueOrphans(reason);
    }
  }

  // 4) Wipe the local session cookies (the user is already gone server-side).
  await supabase.auth.signOut();

  const url = new URL('/login', request.url);
  url.searchParams.set('success', '계정과 모든 데이터가 영구적으로 삭제되었습니다.');
  return NextResponse.redirect(url, { status: 303 });
}
