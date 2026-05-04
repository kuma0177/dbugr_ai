'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function OnboardingPage() {
  const [name, setName] = useState('Demo User');
  const [organizationName, setOrganizationName] = useState('Demo Organization');
  const [role, setRole] = useState('Founder');
  const [teamName, setTeamName] = useState('Product');
  const [inviteEmails, setInviteEmails] = useState('reviewer@example.com');
  const [defaultVisibility, setDefaultVisibility] = useState<'private' | 'org' | 'public'>('private');
  const [status, setStatus] = useState('Ready to create your Phase 2 workspace.');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.info('[phase2-web] onboarding.bootstrap.started');
    api.phase2.bootstrap()
      .then((data) => {
        setName(data.user.name);
        setOrganizationName(data.organization.name);
        setDefaultVisibility((data.organization.defaultVisibility as 'private' | 'org' | 'public') ?? 'private');
        setStatus(`Signed in as ${data.user.email}. ${data.members.length} member(s) in ${data.organization.name}.`);
        console.info('[phase2-web] onboarding.bootstrap.completed', {
          organizationId: data.organization.id,
          members: data.members.length,
          invites: data.invites.length,
        });
      })
      .catch((error) => {
        setStatus(`Bootstrap waiting on API: ${error instanceof Error ? error.message : String(error)}`);
        console.warn('[phase2-web] onboarding.bootstrap.failed', { message: error instanceof Error ? error.message : String(error) });
      });
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setStatus('Creating Google-backed demo identity, org membership, invites, and audit event...');
    console.info('[phase2-web] onboarding.submit.started', {
      organizationName,
      inviteCount: inviteEmails.split(',').map((email) => email.trim()).filter(Boolean).length,
      defaultVisibility,
    });
    try {
      const result = await api.phase2.onboarding({
        name,
        organizationName,
        role,
        teamName,
        defaultVisibility,
        inviteEmails: inviteEmails.split(',').map((email) => email.trim()).filter(Boolean),
      });
      setStatus(`Workspace ready: ${result.organization.name}. ${result.invites.length} invite(s) staged.`);
      console.info('[phase2-web] onboarding.submit.completed', {
        organizationId: result.organization.id,
        inviteCount: result.invites.length,
      });
    } catch (error) {
      setStatus(`Onboarding failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] onboarding.submit.failed', { message: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <section className="phase2-hero">
        <div className="phase2-card">
          <div className="phase2-kicker">Google sign-in shape</div>
          <h1 className="phase2-title">Create your review workspace.</h1>
          <p className="phase2-lede">
            This is the Phase 2 onboarding spine. Today it uses a local demo Google identity;
            production OAuth keys will plug into the same user, organization, membership, invite,
            and audit model.
          </p>
        </div>
        <div className="phase2-card">
          <div className="phase2-kicker">Status</div>
          <p className="phase2-muted mt-16">{loading ? `⌛ ${status}` : status}</p>
          <div className="row gap-12 mt-24">
            <Link className="btn btn-ghost" href="/feed">Review feed</Link>
            <Link className="btn btn-ghost" href="/">Roadmap</Link>
          </div>
        </div>
      </section>

      <form className="phase2-card stack gap-16" onSubmit={submit}>
        <label className="stack gap-8">
          <span className="phase2-kicker">Name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <label className="stack gap-8">
          <span className="phase2-kicker">Organization / startup</span>
          <input className="input" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} />
        </label>
        <div className="phase2-grid">
          <label className="stack gap-8">
            <span className="phase2-kicker">Role optional</span>
            <input className="input" value={role} onChange={(event) => setRole(event.target.value)} />
          </label>
          <label className="stack gap-8">
            <span className="phase2-kicker">Team optional</span>
            <input className="input" value={teamName} onChange={(event) => setTeamName(event.target.value)} />
          </label>
          <label className="stack gap-8">
            <span className="phase2-kicker">Default visibility</span>
            <select className="select" value={defaultVisibility} onChange={(event) => setDefaultVisibility(event.target.value as typeof defaultVisibility)}>
              <option value="private">Private</option>
              <option value="org">Organization</option>
              <option value="public">Public</option>
            </select>
          </label>
        </div>
        <label className="stack gap-8">
          <span className="phase2-kicker">Invite teammates</span>
          <input className="input" value={inviteEmails} onChange={(event) => setInviteEmails(event.target.value)} placeholder="sarah@company.com, mike@company.com" />
        </label>
        <button className="btn btn-primary" disabled={loading}>{loading ? 'Creating workspace...' : 'Continue with Google + create workspace'}</button>
      </form>
    </div>
  );
}
