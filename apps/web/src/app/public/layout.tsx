import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Public Visual Feedback Feed',
  description:
    'Discover public product feedback sessions, annotated screenshots, and visual bug reports before they become AI coding work.',
  alternates: {
    canonical: '/public',
  },
  openGraph: {
    title: 'Dbugr.ai Public Feed',
    description:
      'Discover public annotated screenshots and product feedback sessions before they become AI coding work.',
    url: '/public',
    type: 'website',
  },
};

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return children;
}
