# Repository Guidelines

## Documentation and Screenshot Policy

- Kullanıcı açıkça istemedikçe yeni dokümantasyon dosyası veya `docs/` klasörü oluşturma; `.md`/`.mdx` belgeleri, planlar, inceleme raporları ve sürüm notları da buna dahildir. Bu kural `.local/`, `tmp/` ve diğer geçici/izlenmeyen konumlarda da geçerlidir.
- Gerekli bilgi güncellemelerini ilgili mevcut `README.md` içinde kısa tut; kendiliğinden yeni README veya ayrı rapor oluşturma.
- Kullanıcı açıkça istemedikçe ekran görüntüsü alma, oluşturma, kaydetme veya projeye/PR'a ekleme. UI doğrulamalarını ekran görüntüsü üretmeden yap.
- Mevcut README dosyalarını, bu kural dosyasını, gerekli üçüncü taraf lisans bildirimlerini ve kullanılan test girdilerini koru. Proje kurallarını gerektiğinde bu mevcut `AGENTS.md` içinde güncelle.

## Project Structure & Module Organization

HasarBotu V2 uses TypeScript npm workspaces for insurance claim operations.

- `src/`: React frontend; `app/` handles routing/session, `features/` groups workflows, `components/` holds shared UI, and `data/` contains adapters.
- `public/`: static assets, including branding and desktop assistant resources.
- `services/api/`: Fastify API; `services/file-agent/`: file-operation worker.
- `apps/desktop/`: Electron shell and Windows installer configuration.
- `packages/`: domain rules, Zod contracts, PostgreSQL helpers/migrations, desktop bridge, and shared configuration.
- `scripts/`, `deploy/windows-service/`: validation tools and deployment tooling; documentation stays in the relevant existing README.

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

## Standing Release Requirement

The user has authorized publishing completed user-facing changes to all office users as part of the task. After validation, increment the desktop version, build and smoke-test the Windows x64 installer, and publish the verified package to the existing authenticated office update feed. Verify that an older installed client sees the new version and that the authenticated artifact download matches its size and SHA-256. Preserve the previous manifest and immutable installer. Record the published version and verification results in the existing desktop README; a local build alone does not complete delivery. Follow the office update publication section in `apps/desktop/README.md`. Do not force installation on users' running clients or change repository visibility or public download channels without a separate instruction.

## Coding Style & Naming Conventions

Follow existing TypeScript style: two-space indentation, single quotes, and no semicolons. Use PascalCase for React components/types, camelCase for functions/variables, and descriptive kebab-case module filenames. Preserve strict typing and explicit `.js` imports in backend TypeScript. ESLint includes React Hooks rules; no standalone formatter is configured.

Keep domain rules in `packages/domain`, shared DTOs in `packages/contracts`, and Electron focused on shell responsibilities.

## Testing Guidelines

Use Vitest; frontend tests use jsdom and React Testing Library. Name tests `*.test.ts` or `*.test.tsx`. Run focused tests with `npx vitest run src/utils/search.test.ts` or `npm test --workspace @hasarbotu/domain`.

Add regression coverage for meaningful fixes. Database integration tests require `TEST_DATABASE_URL` pointing to a disposable database whose name ends in `_test`; report skipped tests explicitly. No numeric coverage threshold is configured.

## Commit & Pull Request Guidelines

History favors `feat: ...` and `feat(tracking): ...`, alongside plain maintenance messages. Prefer concise, imperative messages with relevant scopes. Keep changes focused. PRs should describe behavior changes, link issues, and report validation and skipped checks. Include screenshots only when explicitly requested by the user.

## Security & Configuration

Keep credentials, private claim documents, and local environment files out of Git; use anonymized fixtures. Preserve authentication, audit, and user-approval boundaries for critical operations. Do not edit generated `dist/` or `release/` artifacts.
