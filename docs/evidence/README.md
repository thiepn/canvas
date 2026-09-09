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
- GitHub Actions run `34298529147` for application release commit `f429294102146b61107de0427b360fab4c1f9f89` on `main`.

That exact post-merge `main` run passed dependency installation and audit, lint, strict type checking, 33 unit/storage tests, 5 real Worker/Durable Object integration tests, production Worker dry-run, optimized build, **62 expected Chromium/Firefox/WebKit E2E passes with 4 intentional project-specific skips, zero unexpected failures, and zero flaky tests**, plus optimized production-preview smoke. Its retained npm-audit artifact reports **zero vulnerabilities at all severities**.

The historical logs remain here solely to make the transition from the constrained authoring environment to repository-based certification auditable rather than rewriting or deleting the earlier evidence.
