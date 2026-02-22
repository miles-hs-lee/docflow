import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'DocFlow',
  description: 'Policy-based PDF sharing platform powered by Supabase + Vercel'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="app-body">{children}</body>
    </html>
  );
}
