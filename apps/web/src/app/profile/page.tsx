'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { AdminOverview, Invite, Organization, OrganizationMembership, User } from '@feedbackagent/shared';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { clearOnboardingState, displayOnboardingName, readOnboardingState } from '@/lib/onboarding';
import { LogoutButton } from '../logout-button';

type ProfileState = {
  user: User;
  organization: Organization;
  membership: OrganizationMembership;
  members: OrganizationMembership[];
  invites: Invite[];
};

function formatRole(role: string) {
  return role.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value?: string | null) {
  if (!value) return 'Not available';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileState | null>(null);
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [status, setStatus] = useState('Loading profile...');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const activeMembers = useMemo(
    () => profile?.members.filter((member) => member.status === 'active') ?? [],
    [profile?.members],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      const localState = readOnboardingState();
      if (!localState?.userEmail) {
        setStatus('Sign in or create a workspace before opening your profile.');
        return;
      }

      try {
        const bootstrap = await api.phase2.bootstrap();
        if (cancelled) return;
        setProfile(bootstrap);
        setStatus('Profile loaded.');

        if (['owner', 'admin'].includes(bootstrap.membership.role)) {
          try {
            const admin = await api.phase2.adminOverview();
            if (!cancelled) setAdminOverview(admin);
          } catch (error) {
            console.warn('[phase2-web] profile.admin_overview_failed', {
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : String(error);
          setStatus(`Profile unavailable: ${message}`);
        }
      }
    }

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteAccount() {
    if (!profile) return;
    const confirmed = window.confirm(
      `Delete the Dbugr account for ${profile.user.email}? This removes your local sign-in and deletes your account data from the web API. This cannot be undone.`,
    );
    if (!confirmed) return;

    setDeleteBusy(true);
    setStatus('Deleting account...');
    try {
      await api.phase2.deleteAccount();
      clearOnboardingState();
      router.push('/');
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Delete failed: ${message}`);
      setDeleteBusy(false);
    }
  }

  if (!profile) {
    return (
      <section className="workspace-page profile-page">
        <div className="workspace-hero profile-hero">
          <div>
            <div className="phase2-kicker">Profile</div>
            <h1>Your Dbugr account.</h1>
            <p>{status}</p>
          </div>
          <Link className="btn btn-primary" href="/onboarding?flow=sign-in">Sign in</Link>
        </div>
      </section>
    );
  }

  const displayName = displayOnboardingName({
    userName: profile.user.name,
    userEmail: profile.user.email,
  });
  const canOpenAdmin = ['owner', 'admin'].includes(profile.membership.role);

  return (
    <section className="workspace-page profile-page">
      <div className="workspace-hero profile-hero">
        <div>
          <div className="phase2-kicker">Profile</div>
          <h1>{displayName}</h1>
          <p>{status} Manage your identity, workspace membership, and account lifecycle.</p>
        </div>
        <div className="profile-hero-actions">
          <Link className="btn btn-ghost" href="/feed">Notes Feed</Link>
          {canOpenAdmin ? <Link className="btn btn-primary" href="/admin">Admin</Link> : null}
          <LogoutButton className="btn btn-ghost" />
        </div>
      </div>

      <div className="profile-grid">
        <section className="profile-panel">
          <div className="phase2-kicker">Identity</div>
          <dl className="profile-detail-list">
            <div>
              <dt>Name</dt>
              <dd>{profile.user.name || displayName}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{profile.user.email}</dd>
            </div>
            <div>
              <dt>Account role</dt>
              <dd>{formatRole(profile.user.role)}</dd>
            </div>
            <div>
              <dt>Joined</dt>
              <dd>{formatDate(profile.user.createdAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="profile-panel">
          <div className="phase2-kicker">Organization</div>
          <dl className="profile-detail-list">
            <div>
              <dt>Name</dt>
              <dd>{profile.organization.name}</dd>
            </div>
            <div>
              <dt>Your workspace role</dt>
              <dd>{formatRole(profile.membership.role)}</dd>
            </div>
            <div>
              <dt>Team</dt>
              <dd>{profile.membership.team?.name ?? 'No team assigned'}</dd>
            </div>
            <div>
              <dt>Public sharing</dt>
              <dd>{profile.organization.allowPublicSharing ? 'Enabled' : 'Disabled'}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="profile-panel">
        <div className="profile-section-heading">
          <div>
            <div className="phase2-kicker">Team Members</div>
            <h2>{profile.organization.name}</h2>
          </div>
          <span>{activeMembers.length} active member{activeMembers.length === 1 ? '' : 's'}</span>
        </div>
        <div className="profile-member-list">
          {profile.members.map((member) => (
            <div className="profile-member-row" key={member.id}>
              <div>
                <strong>{member.user?.name || member.user?.email || 'Unknown member'}</strong>
                <p>{member.user?.email ?? 'No email'} · {member.team?.name ?? 'No team'}</p>
              </div>
              <div className="profile-member-meta">
                <span>{formatRole(member.role)}</span>
                <small>{member.status}</small>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="profile-panel">
        <div className="profile-section-heading">
          <div>
            <div className="phase2-kicker">Admin Details</div>
            <h2>{canOpenAdmin ? 'Workspace controls enabled' : 'Member access'}</h2>
          </div>
          {canOpenAdmin ? <Link className="btn btn-ghost" href="/admin">Open admin</Link> : null}
        </div>
        {adminOverview ? (
          <div className="metric-grid profile-metrics">
            <div className="metric-card">
              <span>Active users</span>
              <strong>{adminOverview.totals.activeMembers}</strong>
            </div>
            <div className="metric-card">
              <span>Teams</span>
              <strong>{adminOverview.totals.teams}</strong>
            </div>
            <div className="metric-card">
              <span>Pending invites</span>
              <strong>{adminOverview.totals.pendingInvites}</strong>
            </div>
            <div className="metric-card">
              <span>Sessions</span>
              <strong>{adminOverview.totals.sessions}</strong>
            </div>
          </div>
        ) : (
          <p className="phase2-muted">
            Your workspace role is {formatRole(profile.membership.role)}. Owners and admins can manage members, invites, and audit activity from the admin panel.
          </p>
        )}
      </section>

      <section className="profile-panel profile-danger-panel">
        <div>
          <div className="phase2-kicker">Danger Zone</div>
          <h2>Delete account</h2>
          <p>
            This signs you out, removes your web account, deletes sessions you created, and removes your membership from this browser identity.
          </p>
        </div>
        <button className="btn profile-danger-button" type="button" onClick={deleteAccount} disabled={deleteBusy}>
          {deleteBusy ? 'Deleting...' : 'Delete account'}
        </button>
      </section>
    </section>
  );
}
