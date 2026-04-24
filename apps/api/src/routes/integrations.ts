import { Router, Request, Response } from 'express';
import { prisma } from '@feedbackagent/db';

export const integrationsRouter = Router();

const DEMO_ORG_ID = 'org_demo';

// GET /api/integrations
integrationsRouter.get('/integrations', async (_req: Request, res: Response) => {
  const integrations = await prisma.integration.findMany({
    where: { organizationId: DEMO_ORG_ID },
  });
  // Never expose tokens
  const safe = integrations.map(({ encryptedAccessToken: _a, encryptedRefreshToken: _r, ...i }) => i);
  return res.json({ data: safe });
});

// POST /api/integrations/:provider/connect
integrationsRouter.post('/integrations/:provider/connect', async (req: Request, res: Response) => {
  // TODO: replace with real OAuth flow per provider
  const integration = await prisma.integration.upsert({
    where: { id: `${DEMO_ORG_ID}_${req.params.provider}` },
    update: { configJson: JSON.stringify({ mock: true }) },
    create: {
      id: `${DEMO_ORG_ID}_${req.params.provider}`,
      organizationId: DEMO_ORG_ID,
      provider: req.params.provider,
      configJson: JSON.stringify({ mock: true }),
    },
  });
  return res.json({ data: { id: integration.id, provider: integration.provider, connected: true } });
});

// DELETE /api/integrations/:id
integrationsRouter.delete('/integrations/:id', async (req: Request, res: Response) => {
  await prisma.integration.delete({ where: { id: req.params.id } });
  return res.json({ data: { deleted: true } });
});
