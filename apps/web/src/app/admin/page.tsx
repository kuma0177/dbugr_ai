'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { AdminOverview, AdminUserActivity, PlatformAdminOverview } from '@feedbackagent/shared';
import { api } from '@/lib/api';
import {
  createLocalMcpId,
  maskSecret,
  readLocalMcpConnectors,
  type LocalMcpConnector,
  writeLocalMcpConnectors,
} from '@/lib/local-mcp';
import { readOnboardingState } from '@/lib/onboarding';

const ROLE_OPTIONS = ['owner', 'admin', 'member', 'reviewer', 'guest'] as const;

function formatDate(value?: string | null) {
  if (!value) return 'No activity yet';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function isAdmin(role?: string) {
  return role === 'owner' || role === 'admin';
}

export default function AdminPage() {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [platformOverview, setPlatformOverview] = useState<PlatformAdminOverview | null>(null);
  const [status, setStatus] = useState('Loading admin panel...');
  const [busyId, setBusyId] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');
  const [memberTab, setMemberTab] = useState<'active' | 'removed'>('active');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'reviewer' | 'guest'>('member');
  const [inviteTeamId, setInviteTeamId] = useState('');
  const [mcpConnectors, setMcpConnectors] = useState<LocalMcpConnector[]>([]);
  const [mcpName, setMcpName] = useState('Google Stitch');
  const [mcpUrl, setMcpUrl] = useState('https://stitch.googleapis.com/mcp');
  const [mcpHeaderName, setMcpHeaderName] = useState('X-Goog-Api-Key');
  const [mcpApiKey, setMcpApiKey] = useState('');
  const [platformQuery, setPlatformQuery] = useState('');
  const [platformOrganizationId, setPlatformOrganizationId] = useState('');

  const loadWorkspaceAdmin = async () => {
    const onboarding = readOnboardingState();
    if (!onboarding) {
      setStatus('Sign in as a workspace owner or admin before opening this panel.');
      return;
    }

    console.info('[phase2-web] admin.overview.started', { email: onboarding.userEmail });
    try {
      const result = await api.phase2.adminOverview();
      setOverview(result);
      setStatus(`${result.organization.name} admin panel is ready.`);
      console.info('[phase2-web] admin.overview.completed', {
        organizationId: result.organization.id,
        users: result.totals.users,
        pendingInvites: result.totals.pendingInvites,
        role: result.membership.role,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Admin panel unavailable: ${message}`);
      console.warn('[phase2-web] admin.overview.failed', { message });
    }
  };

  const loadPlatformAdmin = async (nextQuery = platformQuery, nextOrganizationId = platformOrganizationId) => {
    console.info('[phase2-web] platform_admin.overview.started', {
      query: nextQuery,
      organizationId: nextOrganizationId,
    });
    try {
      const result = await api.phase2.platformAdminOverview({
        q: nextQuery,
        organizationId: nextOrganizationId,
      });
      setPlatformOverview(result);
      console.info('[phase2-web] platform_admin.overview.completed', {
        users: result.totals.users,
        organizations: result.totals.organizations,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setPlatformOverview(null);
      console.info('[phase2-web] platform_admin.overview.skipped', { message });
    }
  };

  useEffect(() => {
    void loadWorkspaceAdmin();
    void loadPlatformAdmin('', '');
    setMcpConnectors(readLocalMcpConnectors());
  }, []);

  const activityByUser = useMemo(() => {
    const map = new Map<string, AdminUserActivity>();
    overview?.activity.forEach((entry) => map.set(entry.userId, entry));
    return map;
  }, [overview]);

  const filteredMembers = useMemo(() => {
    const normalizedQuery = memberQuery.trim().toLowerCase();
    return (overview?.members ?? []).filter((member) => {
      const matchesStatus = memberTab === 'active' ? member.status === 'active' : member.status === 'revoked';
      const matchesQuery = !normalizedQuery ||
        member.user?.name.toLowerCase().includes(normalizedQuery) ||
        member.user?.email.toLowerCase().includes(normalizedQuery) ||
        member.role.toLowerCase().includes(normalizedQuery);
      const matchesTeam = teamFilter === 'all' || (teamFilter === 'none' ? !member.teamId : member.teamId === teamFilter);
      return matchesStatus && matchesQuery && matchesTeam;
    });
  }, [memberQuery, memberTab, overview?.members, teamFilter]);

  const activeMemberCount = useMemo(
    () => (overview?.members ?? []).filter((member) => member.status === 'active').length,
    [overview?.members],
  );

  const removedMemberCount = useMemo(
    () => (overview?.members ?? []).filter((member) => member.status === 'revoked').length,
    [overview?.members],
  );

  const runMemberMutation = async (memberId: string, action: () => Promise<unknown>) => {
    setBusyId(memberId);
    try {
      await action();
      await loadWorkspaceAdmin();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      console.warn('[phase2-web] admin.member_mutation.failed', { memberId, message });
    } finally {
      setBusyId('');
    }
  };

  const runInviteRevoke = async (inviteId: string) => {
    setBusyId(inviteId);
    try {
      await api.phase2.revokeAdminInvite(inviteId);
      await loadWorkspaceAdmin();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      console.warn('[phase2-web] admin.invite_revoke.failed', { inviteId, message });
    } finally {
      setBusyId('');
    }
  };

  const runInviteCreate = async () => {
    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setStatus('Enter an email address before sending an invite.');
      return;
    }
    setBusyId('new-invite');
    console.info('[phase2-web] admin.invite_create.started', {
      email: normalizedEmail,
      role: inviteRole,
      teamId: inviteTeamId || null,
    });
    try {
      await api.phase2.createAdminInvite({
        email: normalizedEmail,
        role: inviteRole,
        teamId: inviteTeamId || null,
      });
      setInviteEmail('');
      setStatus(`Invite staged for ${normalizedEmail}. They can join with an existing Dbugr account or create one with that email.`);
      await loadWorkspaceAdmin();
      console.info('[phase2-web] admin.invite_create.completed', { email: normalizedEmail });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      console.warn('[phase2-web] admin.invite_create.failed', { email: normalizedEmail, message });
    } finally {
      setBusyId('');
    }
  };

  const runAuditDelete = async (auditLogId: string) => {
    setBusyId(auditLogId);
    try {
      await api.phase2.deleteAdminAudit(auditLogId);
      await loadWorkspaceAdmin();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      console.warn('[phase2-web] admin.audit_delete.failed', { auditLogId, message });
    } finally {
      setBusyId('');
    }
  };

  const saveLocalMcpConnector = () => {
    const name = mcpName.trim();
    const url = mcpUrl.trim();
    const headerName = mcpHeaderName.trim();
    const apiKey = mcpApiKey.trim();

    if (!name || !url || !headerName || !apiKey) {
      setStatus('Add a connector name, MCP URL, header name, and local API key before saving.');
      return;
    }

    try {
      const parsed = new URL(url);
      if (!['https:', 'http:'].includes(parsed.protocol)) {
        setStatus('MCP connector URL must start with https:// or http://.');
        return;
      }
    } catch {
      setStatus('Enter a valid MCP connector URL.');
      return;
    }

    const next = [
      ...mcpConnectors.filter((connector) => connector.name.toLowerCase() !== name.toLowerCase()),
      {
        id: createLocalMcpId(),
        name,
        url,
        headerName,
        apiKey,
        createdAt: new Date().toISOString(),
      },
    ];
    setMcpConnectors(next);
    writeLocalMcpConnectors(next);
    setMcpApiKey('');
    setStatus(`${name} was saved on this device only. Dbugr did not send this key to the API.`);
  };

  const removeLocalMcpConnector = (connectorId: string) => {
    const next = mcpConnectors.filter((connector) => connector.id !== connectorId);
    setMcpConnectors(next);
    writeLocalMcpConnectors(next);
    setStatus('Local MCP connector removed from this browser.');
  };

  if (!overview) {
    return (
      <section className="workspace-page admin-page-flat">
        <div className="workspace-hero admin-hero-flat">
          <div>
            <div className="phase2-kicker">Admin</div>
            <h1>Workspace controls.</h1>
            <p>{status}</p>
          </div>
          <Link className="btn btn-primary" href="/feed">Back to Notes Feed</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-page admin-page-flat">
      <div className="workspace-hero admin-hero-flat">
        <div>
          <div className="phase2-kicker">Owner admin panel</div>
          <h1>Manage {overview.organization.name}.</h1>
          <p>{status} Search members, adjust roles, revoke access, and inspect workspace activity.</p>
        </div>
        <Link className="btn btn-ghost" href="/feed">Back to Notes Feed</Link>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <span>Active users</span>
          <strong>{activeMemberCount}</strong>
        </div>
        <div className="metric-card">
          <span>Teams</span>
          <strong>{overview.totals.teams}</strong>
        </div>
        <div className="metric-card">
          <span>Pending invites</span>
          <strong>{overview.totals.pendingInvites}</strong>
        </div>
        <div className="metric-card">
          <span>Sessions</span>
          <strong>{overview.totals.sessions}</strong>
        </div>
      </div>

      <section className="admin-panel admin-panel-wide">
        <div className="admin-panel-title">
          <div>
            <div className="phase2-kicker">Members</div>
            <h2>Users and access</h2>
            <p className="phase2-muted">
              Active users can access this workspace. Removed users are hidden from the working list and kept in their own tab for audit history.
            </p>
          </div>
          <div className="admin-controls">
            <input
              aria-label="Search members"
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="Search name, email, or role"
            />
            <select aria-label="Filter by team" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
              <option value="all">All teams</option>
              <option value="none">No team</option>
              {overview.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </div>
        </div>

        <div className="admin-tabs" role="tablist" aria-label="Member status">
          <button
            type="button"
            className={memberTab === 'active' ? 'active' : ''}
            onClick={() => setMemberTab('active')}
          >
            Active users <span>{activeMemberCount}</span>
          </button>
          <button
            type="button"
            className={memberTab === 'removed' ? 'active' : ''}
            onClick={() => setMemberTab('removed')}
          >
            Removed users <span>{removedMemberCount}</span>
          </button>
        </div>

        <div className="admin-table-flat">
          {filteredMembers.map((member) => {
            const activity = activityByUser.get(member.userId);
            const isSelf = member.userId === overview.viewer.id;
            const canEditTarget = isAdmin(overview.membership.role) && (!isSelf || overview.membership.role === 'owner');
            return (
              <div className={`admin-row-flat ${memberTab === 'removed' ? 'admin-row-removed' : ''}`} key={member.id}>
                <div className="admin-member-cell">
                  <strong>{member.user?.name ?? member.userId}</strong>
                  <p>{member.user?.email ?? 'No email'} · {member.team?.name ?? 'No team'}</p>
                </div>
                <select
                  aria-label={`Role for ${member.user?.email ?? member.userId}`}
                  disabled={!canEditTarget || busyId === member.id}
                  value={member.role}
                  onChange={(event) => runMemberMutation(member.id, () => api.phase2.updateAdminMember(member.id, { role: event.target.value }))}
                >
                  {ROLE_OPTIONS.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <span className={`admin-status-pill ${member.status === 'active' ? 'active' : ''}`}>{member.status}</span>
                <span>{activity?.sessionCount ?? 0} sessions</span>
                <span>{activity?.commentCount ?? 0} comments</span>
                <span>{formatDate(activity?.lastSeenAt)}</span>
                {memberTab === 'active' ? (
                  <button
                    className="admin-danger-button"
                    type="button"
                    disabled={isSelf || busyId === member.id}
                    onClick={() => runMemberMutation(member.id, () => api.phase2.removeAdminMember(member.id))}
                  >
                    {busyId === member.id ? 'Removing...' : 'Remove'}
                  </button>
                ) : (
                  <span className="admin-muted-action">Deleted</span>
                )}
              </div>
            );
          })}
          {filteredMembers.length === 0 ? (
            <p className="phase2-muted">
              {memberTab === 'active'
                ? 'No active members match this search.'
                : 'No deleted users match this search.'}
            </p>
          ) : null}
        </div>
      </section>

      <div className="admin-grid">
        <section className="admin-panel admin-panel-wide">
          <div className="admin-panel-title">
            <div>
              <div className="phase2-kicker">Invite teammates</div>
              <h2>Add people to this workspace</h2>
              <p className="phase2-muted">
                Invite a teammate by email. If they already have a Dbugr account, the invite attaches to that account when they sign in with the same email.
              </p>
            </div>
          </div>
          <div className="admin-invite-form">
            <input
              aria-label="Invite teammate email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@company.com"
            />
            <select aria-label="Invite role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}>
              <option value="member">Member</option>
              <option value="reviewer">Reviewer</option>
              <option value="admin">Admin</option>
              <option value="guest">Guest</option>
            </select>
            <select aria-label="Invite team" value={inviteTeamId} onChange={(event) => setInviteTeamId(event.target.value)}>
              <option value="">No team</option>
              {overview.teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
            <button className="btn btn-primary" type="button" disabled={busyId === 'new-invite'} onClick={runInviteCreate}>
              {busyId === 'new-invite' ? 'Sending invite...' : 'Invite teammate'}
            </button>
          </div>
        </section>

        <section className="admin-panel admin-panel-wide local-mcp-panel">
          <div className="admin-panel-title">
            <div>
              <div className="phase2-kicker">Local MCP integrations</div>
              <h2>Connect tools without sharing keys</h2>
              <p className="phase2-muted">
                Add MCP URLs and API keys on this device. These values stay in this browser’s local storage and are never sent to the Dbugr API, workspace admins, or platform admins.
              </p>
            </div>
          </div>
          <div className="local-mcp-form">
            <label>
              <span>Connector name</span>
              <input
                value={mcpName}
                onChange={(event) => setMcpName(event.target.value)}
                placeholder="Google Stitch"
              />
            </label>
            <label>
              <span>MCP server URL</span>
              <input
                value={mcpUrl}
                onChange={(event) => setMcpUrl(event.target.value)}
                placeholder="https://stitch.googleapis.com/mcp"
              />
            </label>
            <label>
              <span>Header name</span>
              <input
                value={mcpHeaderName}
                onChange={(event) => setMcpHeaderName(event.target.value)}
                placeholder="X-Goog-Api-Key"
              />
            </label>
            <label>
              <span>Local API key</span>
              <input
                type="password"
                value={mcpApiKey}
                onChange={(event) => setMcpApiKey(event.target.value)}
                placeholder="Paste key; stored only on this device"
              />
            </label>
            <button className="btn btn-primary" type="button" onClick={saveLocalMcpConnector}>
              Save local connector
            </button>
          </div>
          <div className="local-mcp-list">
            {mcpConnectors.map((connector) => (
              <div className="local-mcp-card" key={connector.id}>
                <div>
                  <strong>{connector.name}</strong>
                  <p>{connector.url}</p>
                  <span>{connector.headerName}: {maskSecret(connector.apiKey)}</span>
                </div>
                <button className="admin-danger-button" type="button" onClick={() => removeLocalMcpConnector(connector.id)}>
                  Remove local key
                </button>
              </div>
            ))}
            {mcpConnectors.length === 0 ? (
              <p className="phase2-muted">No local MCP connectors saved yet. Add Google Stitch or another MCP-compatible tool above.</p>
            ) : null}
          </div>
        </section>

        <section className="admin-panel">
          <div className="phase2-kicker">Teams</div>
          <h2>Team structure</h2>
          <div className="admin-list">
            {overview.teams.map((team) => (
              <div className="admin-list-item" key={team.id}>
                <strong>{team.name}</strong>
                <p>{overview.members.filter((member) => member.teamId === team.id && member.status === 'active').length} active member(s)</p>
              </div>
            ))}
            {overview.teams.length === 0 ? <p className="phase2-muted">No teams created yet.</p> : null}
          </div>
        </section>

        <section className="admin-panel">
          <div className="phase2-kicker">Invites</div>
          <h2>Pending access</h2>
          <div className="admin-list">
            {overview.invites.map((invite) => (
              <div className="admin-list-item admin-list-item-action" key={invite.id}>
                <div>
                  <strong>{invite.email}</strong>
                  <p>{invite.role} · expires {formatDate(invite.expiresAt)}</p>
                </div>
                <button className="admin-danger-button" type="button" disabled={busyId === invite.id} onClick={() => runInviteRevoke(invite.id)}>
                  {busyId === invite.id ? 'Removing...' : 'Delete'}
                </button>
              </div>
            ))}
            {overview.invites.length === 0 ? <p className="phase2-muted">No pending invites.</p> : null}
          </div>
        </section>

        <section className="admin-panel admin-panel-wide">
          <div className="admin-panel-title">
            <div>
              <div className="phase2-kicker">Audit</div>
              <h2>Recent workspace activity</h2>
            </div>
            <p className="phase2-muted">These are real events from the API. Owners can remove noisy items from this admin view.</p>
          </div>
          <div className="admin-list">
            {overview.auditLogs.map((log) => (
              <div className="admin-list-item admin-list-item-action" key={log.id}>
                <div>
                  <strong>{log.action}</strong>
                  <p>{log.actor?.name ?? log.actorId} · {formatDate(log.createdAt)}</p>
                </div>
                <button className="admin-danger-button" type="button" disabled={busyId === log.id || overview.membership.role !== 'owner'} onClick={() => runAuditDelete(log.id)}>
                  {busyId === log.id ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            ))}
            {overview.auditLogs.length === 0 ? <p className="phase2-muted">No audit events yet.</p> : null}
          </div>
        </section>
      </div>

      <section className="admin-panel admin-panel-wide platform-admin-panel">
        <div className="admin-panel-title">
          <div>
            <div className="phase2-kicker">Dbugr platform admin</div>
            <h2>Search all users and organizations</h2>
            <p className="phase2-muted">Available only to emails listed in <code>DEBUGR_SUPER_ADMIN_EMAILS</code> or users with a platform admin role.</p>
          </div>
          <div className="admin-controls">
            <input
              aria-label="Search all Dbugr users"
              value={platformQuery}
              onChange={(event) => setPlatformQuery(event.target.value)}
              placeholder="Search users or orgs"
            />
            <select
              aria-label="Filter platform admin by organization"
              value={platformOrganizationId}
              onChange={(event) => setPlatformOrganizationId(event.target.value)}
            >
              <option value="">All organizations</option>
              {platformOverview?.organizations.map((entry) => (
                <option key={entry.organization.id} value={entry.organization.id}>{entry.organization.name}</option>
              ))}
            </select>
            <button className="btn btn-primary" type="button" onClick={() => loadPlatformAdmin(platformQuery, platformOrganizationId)}>Search</button>
          </div>
        </div>

        {platformOverview ? (
          <div className="platform-admin-results">
            <div className="admin-mini-metrics">
              <span>{platformOverview.totals.users} users</span>
              <span>{platformOverview.totals.organizations} orgs</span>
              <span>{platformOverview.totals.sessions} sessions</span>
              <span>{platformOverview.totals.pendingInvites} pending invites</span>
            </div>
            <div className="admin-table-flat">
              {platformOverview.users.map((entry) => (
                <div className="admin-row-flat platform-row" key={entry.user.id}>
                  <div className="admin-member-cell">
                    <strong>{entry.user.name}</strong>
                    <p>{entry.user.email}</p>
                  </div>
                  <span>{entry.memberships.map((membership) => membership.organization?.name).filter(Boolean).join(', ') || 'No org'}</span>
                  <span>{entry.memberships.map((membership) => membership.role).join(', ') || 'No role'}</span>
                  <span>{entry.sessionCount} sessions</span>
                  <span>{entry.commentCount} comments</span>
                  <span>{formatDate(entry.lastSeenAt)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="phase2-muted">Platform-wide search is hidden unless this signed-in account is a Dbugr platform admin.</p>
        )}
      </section>
    </section>
  );
}
