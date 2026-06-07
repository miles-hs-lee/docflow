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

  // 0) Workspace guard: deleting the auth user cascades away every owner_id row,
  // which now belongs to a SHARED workspace. Block deletion while the user is the
  // SOLE owner of any workspace that has other members — otherwise the workspace
  // is left ownerless (nobody can administer it) and the departing owner's shared
  // content vanishes for teammates. They must transfer ownership (promote another
  // member to owner) or remove the other members first.
  const { data: ownedWorkspaces } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id)
    .eq('role', 'owner');
  for (const row of (ownedWorkspaces ?? []) as Array<{ workspace_id: string }>) {
    const [{ count: memberCount }, { count: ownerCount }] = await Promise.all([
      admin.from('workspace_members').select('user_id', { count: 'exact', head: true }).eq('workspace_id', row.workspace_id),
      admin
        .from('workspace_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('workspace_id', row.workspace_id)
        .eq('role', 'owner')
    ]);
    if ((memberCount ?? 0) > 1 && (ownerCount ?? 0) <= 1) {
      return redirectToSettings(
        request.url,
        'error',
        '다른 멤버가 있는 워크스페이스의 유일한 소유자입니다. 팀 페이지에서 소유권을 이전하거나 멤버를 제거한 뒤 다시 시도해주세요.'
      );
    }
  }

  // 1) Snapshot storage paths BEFORE we delete the auth user. If the
  // listing itself fails we abort — proceeding would leak the orphan
  // paths since we'd no longer be able to recover them after cascade.
  let paths: string[] = [];
  let requestPaths: string[] = [];
  let logoPaths: string[] = [];
  try {
    const { data: files, error: listError } = await admin
      .from('files')
      .select('storage_path')
      .eq('owner_id', user.id);
    if (listError) throw listError;
    paths = (files ?? [])
      .map((f) => (f as { storage_path: string }).storage_path)
      .filter((p): p is string => Boolean(p));

    // File-request uploads live in the request-uploads bucket and cascade-delete
    // with the user, so snapshot their paths now or they orphan after deleteUser.
    const { data: uploads, error: uploadsError } = await admin
      .from('file_request_uploads')
      .select('storage_path')
      .eq('owner_id', user.id);
    if (uploadsError) throw uploadsError;
    requestPaths = (uploads ?? [])
      .map((u) => (u as { storage_path: string }).storage_path)
      .filter((p): p is string => Boolean(p));

    // Branding images live in the public owner-logos bucket and cascade too —
    // the account logo + cover plus every per-data-room logo + cover.
    const { data: brand, error: brandError } = await admin
      .from('owner_branding')
      .select('logo_path, cover_image_path')
      .eq('owner_id', user.id)
      .maybeSingle();
    if (brandError) throw brandError;
    const { data: roomBrands, error: roomBrandError } = await admin
      .from('collection_branding')
      .select('logo_path, cover_image_path')
      .eq('owner_id', user.id);
    if (roomBrandError) throw roomBrandError;
    const accountBrand = brand as { logo_path: string | null; cover_image_path: string | null } | null;
    logoPaths = [
      accountBrand?.logo_path ?? null,
      accountBrand?.cover_image_path ?? null,
      ...((roomBrands ?? []) as Array<{ logo_path: string | null; cover_image_path: string | null }>).flatMap((row) => [
        row.logo_path,
        row.cover_image_path
      ])
    ].filter((p): p is string => Boolean(p));
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
  // Clean each bucket; failures (error OR throw) queue into
  // pending_storage_deletions WITH their bucket so the sweep job can target the
  // right bucket. Untracked orphans must never survive a completed account delete.
  const cleanupBucket = async (bucket: string, objectPaths: string[]) => {
    if (objectPaths.length === 0) return;

    const queueOrphans = async (reason: string) => {
      try {
        await admin.from('pending_storage_deletions').insert(
          objectPaths.map((p) => ({
            storage_path: p,
            bucket,
            reason: `account_delete: ${reason}`
          }))
        );
      } catch (queueErr) {
        console.error('[deleteAccount] failed to queue storage cleanup', {
          ownerId: user.id,
          bucket,
          count: objectPaths.length,
          queueErr: queueErr instanceof Error ? queueErr.message : 'unknown_error'
        });
      }
    };

    try {
      const { error: storageError } = await admin.storage.from(bucket).remove(objectPaths);
      if (storageError) {
        console.error('[deleteAccount] storage bulk remove failed', {
          ownerId: user.id,
          bucket,
          count: objectPaths.length,
          reason: storageError.message
        });
        await queueOrphans(storageError.message);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'unknown_throw';
      console.error('[deleteAccount] storage cleanup threw', {
        ownerId: user.id,
        bucket,
        count: objectPaths.length,
        reason
      });
      await queueOrphans(reason);
    }
  };

  await cleanupBucket('pdf-files', paths);
  await cleanupBucket('request-uploads', requestPaths);
  await cleanupBucket('owner-logos', logoPaths);

  // 4) Wipe the local session cookies (the user is already gone server-side).
  await supabase.auth.signOut();

  const url = new URL('/login', request.url);
  url.searchParams.set('success', '계정과 모든 데이터가 영구적으로 삭제되었습니다.');
  return NextResponse.redirect(url, { status: 303 });
}
