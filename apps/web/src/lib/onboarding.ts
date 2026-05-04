export const ONBOARDING_STORAGE_KEY = 'dbugr_phase2_onboarding';

export interface OnboardingState {
  userName: string;
  userEmail: string;
  organizationName: string;
  role?: string;
  teamName?: string;
  inviteEmails: string[];
  defaultVisibility: 'private' | 'org' | 'public';
  completedAt: string;
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
  console.info('[phase2-web] onboarding.local_state_saved', {
    organizationName: state.organizationName,
    teamName: state.teamName,
    inviteCount: state.inviteEmails.length,
    defaultVisibility: state.defaultVisibility,
  });
}

export function clearOnboardingState() {
  window.localStorage.removeItem(ONBOARDING_STORAGE_KEY);
  console.info('[phase2-web] onboarding.local_state_cleared');
}
