import { createAdminClient } from '@/lib/supabase/admin';

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

export async function ensurePreviewTestUser(email: string, password: string) {
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
