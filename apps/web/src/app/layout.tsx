import type { Metadata } from 'next';
import './globals.css';
import { NavShell } from './nav-shell';

export const metadata: Metadata = {
  title: 'Dbugr.ai',
  description: 'Collaborative screenshot review and AI handoff for product teams',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
    shortcut: '/favicon.ico',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NavShell />
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
