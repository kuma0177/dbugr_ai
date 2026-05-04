import { unstable_noStore as noStore } from 'next/cache';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  noStore();
  return children;
}
