import { redirect } from 'next/navigation';

import { getOwner } from '@/lib/auth';

export default async function HomePage() {
  const { user } = await getOwner();

  if (user) {
    redirect('/dashboard');
  }

  redirect('/login');
}
