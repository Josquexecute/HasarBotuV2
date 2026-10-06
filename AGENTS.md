# Repository Guidelines

## Project Structure & Module Organization

HasarBotu V2 uses TypeScript npm workspaces for insurance claim operations.

- `src/`: React frontend; `app/` handles routing/session, `features/` groups workflows, `components/` holds shared UI, and `data/` contains adapters.
- `public/`: static assets, including branding and desktop assistant resources.
- `services/api/`: Fastify API; `services/file-agent/`: file-operation worker.
- `apps/desktop/`: Electron shell and Windows installer configuration.
- `packages/`: domain rules, Zod contracts, PostgreSQL helpers/migrations, desktop bridge, and shared configuration.
- `docs/`, `scripts/`, `deploy/windows-service/`: documentation, validation tools, and deployment tooling.

Frontend tests sit beside source; workspace tests live in `test/` directories.

## Build, Test, and Development Commands

Use Node.js 24.x; run commands from the repository root.

- `npm ci`: install locked dependencies and build workspaces through `prepare`.
- `npm run dev`: start Vite; `/api` proxies to `127.0.0.1:3100`.
- `npm run dev:api`: start the API with watch mode.
- `npm run typecheck` / `npm run lint`: check TypeScript and ESLint rules.
- `npm test`: build shared dependencies and run frontend/workspace suites.
- `npm run build`: build the frontend and all workspaces; check frontend bundle boundaries.
- `npm run package:win --workspace @hasarbotu/desktop`: produce the x64 NSIS installer after building.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, and no semicolons. Use PascalCase for React components/types, camelCase for functions/variables, and descriptive kebab-case module filenames. Preserve strict typing and explicit `.js` imports in backend TypeScript. ESLint includes React Hooks rules; no standalone formatter is configured.

Keep domain rules in `packages/domain`, shared DTOs in `packages/contracts`, and Electron focused on shell responsibilities.

## Testing Guidelines

Use Vitest; frontend tests use jsdom and React Testing Library. Name tests `*.test.ts` or `*.test.tsx`. Run focused tests with `npx vitest run src/utils/search.test.ts` or `npm test --workspace @hasarbotu/domain`.

Add regression coverage for meaningful fixes. Database integration tests require `TEST_DATABASE_URL` pointing to a disposable database whose name ends in `_test`; report skipped tests explicitly. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

History favors `feat: ...` and `feat(tracking): ...`, alongside plain maintenance messages. Prefer concise, imperative messages with relevant scopes. Keep changes focused. PRs should describe behavior changes, link issues, report validation and skipped checks, and include screenshots for UI changes.

## Security & Configuration

Keep credentials, private claim documents, and local environment files out of Git; use anonymized fixtures. Preserve authentication, audit, and user-approval boundaries for critical operations. Do not edit generated `dist/` or `release/` artifacts.
