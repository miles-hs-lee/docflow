import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

async function getSafeUser(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const {
      data: { user },
      error
    } = await supabase.auth.getUser();

    if (error) {
      return null;
    }

    return user ?? null;
  } catch {
    return null;
  }
}

export async function requireOwner() {
  const supabase = await createClient();
  const user = await getSafeUser(supabase);

  if (!user) {
    redirect('/login');
  }

  return { user, supabase };
}

export async function getOwner() {
  const supabase = await createClient();
  const user = await getSafeUser(supabase);

  return { user, supabase };
}
