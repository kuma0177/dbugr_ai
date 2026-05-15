import type { Metadata } from 'next';
import './globals.css';
import { NavShell } from './nav-shell';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.dbugr.ai';
const SITE_DESCRIPTION =
  'Dbugr.ai is a macOS screenshot annotation tool that turns product feedback into repo-aware prompts for Claude Code, Codex, and Cursor.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: 'Dbugr.ai',
  title: {
    default: 'Dbugr.ai | Screenshot Feedback for AI Coding Agents',
    template: '%s | Dbugr.ai',
  },
  description: SITE_DESCRIPTION,
  keywords: [
    'AI coding agent feedback',
    'screenshot annotation tool',
    'Claude Code feedback',
    'Codex CLI feedback',
    'Cursor AI prompts',
    'repo-aware product feedback',
    'macOS annotation app',
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'Dbugr.ai | Screenshot Feedback for AI Coding Agents',
    description: SITE_DESCRIPTION,
    url: '/',
    siteName: 'Dbugr.ai',
    type: 'website',
    images: [
      {
        url: '/brand/icon-nav-1024.png',
        width: 1024,
        height: 1024,
        alt: 'Dbugr.ai screenshot feedback app icon',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Dbugr.ai | Screenshot Feedback for AI Coding Agents',
    description: SITE_DESCRIPTION,
    images: ['/brand/icon-nav-1024.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
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
