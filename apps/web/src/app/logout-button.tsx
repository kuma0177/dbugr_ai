'use client';

import { useRouter } from 'next/navigation';
import { clearOnboardingState } from '@/lib/onboarding';

type Props = {
  className?: string;
  label?: string;
};

export function LogoutButton({ className = 'nav-auth-button nav-auth-button-secondary', label = 'Sign out' }: Props) {
  const router = useRouter();

  function signOut() {
    clearOnboardingState();
    router.push('/');
    router.refresh();
  }

  return (
    <button className={className} type="button" onClick={signOut}>
      {label}
    </button>
  );
}
