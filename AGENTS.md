# Repository Guidelines

## Project Structure

`src/routes/` contains TanStack Start pages and the API route. App features live in `src/components/app/`, reusable shadcn/Base UI primitives in `src/components/ui/`, and theme tokens in `src/lib/theme/`.

Keep personal state in IndexedDB (`src/lib/personal.tsx`) and shared YouTube metadata in D1. `src/server/` handles API requests, queries, and sync. `src/worker.ts` handles HTTP and scheduled events. Put numbered SQL migrations in `migrations/`, assets in `public/`, and tests in `tests/`.

## Build and Development

- Install locked dependencies with Node.js 24 and `npm ci`.
- Run `npm run db:migrate` to apply local D1 migrations, then `npm run dev` to serve the app at `http://127.0.0.1:5173`.
- Run `npm run typecheck` for strict TypeScript checks and `npm run bindings` after changing Worker bindings.
- Build with `npm run build` and preview locally with `npm run preview -- --port 4173`.
- Run `npm run cron:local` against the dev server to exercise the scheduled handler.

## Coding Style

Follow surrounding TypeScript and TSX formatting. Use two-space indentation, single-quoted strings, and omit trailing semicolons. Use PascalCase for React components, camelCase for functions, and kebab-case for multiword component filenames. Follow TanStack route names such as `channel.$id.tsx`. Regenerate `src/routeTree.gen.ts` through Vite and `worker-configuration.d.ts` through `npm run bindings`.

## Testing

Run `npm test` for Vitest `tests/*.test.ts` files. Use temporary Miniflare D1 databases and stubbed YouTube responses for sync tests. Cover changed behavior and regressions.

With production preview running, run `npm run test:browser` for Playwright `tests/*.spec.ts` files in local Chrome. Set `MYTUBE_LIVE=1` to include live YouTube tests with a valid key. Use `npm run test:security` to check routing and secret exposure, and `npm run test:performance` to measure homepage load.

## Commits and Pull Requests

Use short, imperative subjects such as `chore: license mytube under MIT`. In PRs, summarize behavior changes, list verification commands, link related issues, and include screenshots for UI changes. Flag migration or binding changes.

## Configuration and Deployment

Copy `.env.example` to `.env.local` and set `YOUTUBE_API_KEY`. Keep credentials out of Git.

1. Sign in to Cloudflare. On first setup, run `npx wrangler d1 create mytube` and replace the placeholder `database_id` in `wrangler.jsonc`.
2. Apply remote migrations with `npx wrangler d1 migrations apply mytube --remote`, then run `npm run build` and `npm run deploy:check` for a dry run.
3. Set the production secret with `npx wrangler secret put YOUTUBE_API_KEY`.
4. From the repository root, run `npx wrangler deploy`. Verify the app, D1 binding, and Cron trigger.
