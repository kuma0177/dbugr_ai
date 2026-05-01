const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const count = await prisma.feedbackSession.count();
  console.log('Sessions:', count);
}
main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
