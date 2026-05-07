export const ONBOARDING_STORAGE_KEY = 'dbugr_phase2_onboarding';

export interface OnboardingState {
  userName: string;
  userEmail: string;
  organizationName: string;
  organizationLogoUrl?: string;
  role?: string;
  teamName?: string;
  inviteEmails: string[];
  defaultVisibility: 'private' | 'org' | 'public';
  completedAt: string;
}

export function displayOnboardingName(state: Pick<OnboardingState, 'userName' | 'userEmail'> | null): string {
  if (!state?.userEmail) return '';
  const normalizedName = state.userName.trim();
  const normalizedEmail = state.userEmail.trim().toLowerCase();
  const isDemoName = normalizedName.toLowerCase() === 'demo user';
  const isDemoEmail = normalizedEmail === 'demo@example.com';
  if (!normalizedName || (isDemoName && !isDemoEmail)) {
    return normalizedEmail.split('@')[0] || normalizedEmail;
  }
  return normalizedName;
}

export function readOnboardingState(): OnboardingState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(ONBOARDING_STORAGE_KEY);
    return raw ? JSON.parse(raw) as OnboardingState : null;
  } catch (error) {
    console.warn('[phase2-web] onboarding.local_state_read_failed', {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function writeOnboardingState(state: OnboardingState) {
  window.localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent('dbugr-auth-changed'));
  console.info('[phase2-web] onboarding.local_state_saved', {
    organizationName: state.organizationName,
    teamName: state.teamName,
    inviteCount: state.inviteEmails.length,
    defaultVisibility: state.defaultVisibility,
  });
}

export function clearOnboardingState() {
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('dbugr-auth-changed'));
  console.info('[phase2-web] onboarding.local_state_cleared');
}
