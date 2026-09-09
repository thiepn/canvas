# Historical authoring-run evidence

This directory preserves the **original source-generation environment evidence** from before the repository was uploaded to GitHub. It is historical diagnostic material, not the current release-certification record.

The original authoring environment could not reach the npm registry, so several files here intentionally record failed or blocked setup attempts:

- `install.log`, `install-exit.txt`, and `registry-dns.log` capture the blocked package-install/DNS state;
- `build-attempt.log`, `lint-attempt.log`, `typecheck-attempt.log`, `check-worker-attempt.log`, and `test-worker-attempt.log` record checks that could not complete correctly without the installed dependency graph;
- `unit.log` records the dependency-independent 33-test Node run available at that time;
- `core-typecheck.log` is empty because its successful dependency-independent TypeScript invocation emitted no diagnostics;
- `syntax.log` covers the then-current source syntax but did not resolve installed editor modules.

**Do not use these files to determine the current release status.** After upload to `thiepn/canvas`, GitHub Actions supplied a working npm/network environment and the project was hardened and fully exercised there.

The authoritative current evidence is:

- [`../verification.json`](../verification.json) — machine-readable release record;
- [`../../TESTING.md`](../../TESTING.md) — test strategy, exact counts, performance evidence, and remaining platform-only checks;
- [`../../AUDIT.md`](../../AUDIT.md) — final quality audit and known limitations;
- GitHub Actions for PR #1 / the final `main` merge SHA.

The certified implementation run (`34296811474`, implementation head `44acf2d7d492be2f3a0afaa31748f7d4e87a2f1f`) passed dependency installation and audit, lint, strict type checking, 33 unit/storage tests, 5 real Worker/Durable Object integration tests, production Worker dry-run, optimized build, **62 Chromium/Firefox/WebKit E2E tests with 4 intentional platform-specific skips and zero failures/flakes**, and optimized production-preview smoke. The recorded npm audit reported **zero vulnerabilities at all severities**.

The historical logs remain here solely to make the transition from the constrained authoring environment to repository-based certification auditable rather than rewriting or deleting the earlier evidence.
