import { createAdminClient } from '@/lib/supabase/admin';
import { normalizeEmail } from '@/lib/security';

async function findUserByEmail(email: string) {
  const admin = createAdminClient();
  const target = normalizeEmail(email);
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      return null;
    }

    const user = data.users.find((item) => normalizeEmail(item.email || '') === target);
    if (user) {
      return user;
    }

    if (!data.nextPage) {
      return null;
    }

    page = data.nextPage;
  }
}

export async function confirmUserEmailIfNeeded(email: string) {
  const admin = createAdminClient();
  const user = await findUserByEmail(email);

  if (!user) return false;
  if (user.email_confirmed_at) return true;

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    email_confirm: true
  });

  return !error;
}
