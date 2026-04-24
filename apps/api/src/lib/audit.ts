import { prisma } from '@feedbackagent/db';

export async function auditLog(params: {
  organizationId: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      organizationId: params.organizationId,
      actorId: params.actorId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
    },
  });
}
