import { prisma } from '@feedbackagent/db';

export async function auditToolCall(toolName: string, args: Record<string, unknown>) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: 'org_demo',
        actorId: 'mcp_agent',
        action: `mcp.${toolName}`,
        targetType: 'MCPTool',
        targetId: toolName,
        metadataJson: JSON.stringify(args),
      },
    });
  } catch {
    // Audit log failure must never block tool execution
    console.error('[mcp] Audit log failed for', toolName);
  }
}
