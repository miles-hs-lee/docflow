import type { Metadata } from 'next';

import { PolarisProvider } from '@/components/polaris-provider';

import './globals.css';

export const metadata: Metadata = {
  title: 'DocFlow',
  description: 'Polaris Design 기반의 정책형 PDF 공유 및 문서 운영 서비스',
  icons: {
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    shortcut: ['/favicon.svg'],
    apple: [{ url: '/favicon.svg', type: 'image/svg+xml' }]
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" data-theme="light">
      <body className="app-body">
        <PolarisProvider>{children}</PolarisProvider>
      </body>
    </html>
  );
}
