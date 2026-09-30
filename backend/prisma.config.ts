import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Prisma 7 removed the `package.json#prisma` block. Keep the seed command here
// and point the CLI at the schema; `.env` loading is automatic.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
