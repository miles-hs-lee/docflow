'use server';

import { redirect } from 'next/navigation';

import { serverEnv } from '@/lib/env-server';
import { canUsePreviewTestLogin } from '@/lib/preview-login';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeEmail } from '@/lib/security';

async function findUserByEmail(email: string) {
  const admin = createAdminClient();
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      return null;
    }

    const user = data.users.find((item) => (item.email || '').toLowerCase() === email);
    if (user) {
      return user;
    }

    if (!data.nextPage) {
      return null;
    }

    page = data.nextPage;
  }
}

async function ensurePreviewTestUser(email: string, password: string) {
  const admin = createAdminClient();

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });

  if (!created.error) {
    return;
  }

  const existingUser = await findUserByEmail(email);
  if (!existingUser) {
    throw created.error;
  }

  const updated = await admin.auth.admin.updateUserById(existingUser.id, {
    password,
    email_confirm: true
  });

  if (updated.error) {
    throw updated.error;
  }
}

export async function previewTestLoginAction(formData: FormData) {
  if (!canUsePreviewTestLogin()) {
    redirect('/login?error=Preview%20테스트%20로그인이%20비활성화되어%20있습니다.');
  }

  const enteredEmail = normalizeEmail(((formData.get('email') as string | null) || '').trim());
  const enteredPassword = ((formData.get('password') as string | null) || '').trim();

  const expectedEmail = normalizeEmail(serverEnv.previewTestEmail);
  const expectedPassword = serverEnv.previewTestPassword;

  if (!enteredEmail || !enteredPassword || enteredEmail !== expectedEmail || enteredPassword !== expectedPassword) {
    redirect('/login?error=테스트%20계정%20정보가%20일치하지%20않습니다.');
  }

  await ensurePreviewTestUser(expectedEmail, expectedPassword);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: expectedEmail,
    password: expectedPassword
  });

  if (error) {
    redirect('/login?error=테스트%20로그인에%20실패했습니다.');
  }

  redirect('/dashboard?success=Preview%20테스트%20계정으로%20로그인되었습니다.');
}
