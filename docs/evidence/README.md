# Actual execution evidence

See `../verification.json` for commands, exit codes, scope and SHA-256 hashes.

`unit.log` is the final 33-test Node run. It includes real SQLite-backed backup tests. `core-typecheck.log` is empty because that successful TypeScript invocation emitted no diagnostics; its command and zero exit status are recorded in the execution manifest. `syntax.log` covers all 52 then-current TS/TSX/JS source files but does not resolve installed editor modules.

The other command logs are **failed setup attempts**, not passing release checks. Missing packages are a consequence of blocked npm registry access. `install.log` is empty because the bounded registry installation produced no output before it was terminated; `install-exit.txt` records 124, and `registry-dns.log` records the actual DNS failure. No silence is interpreted as installation success.

No browser, deployed-Worker, performance, Lighthouse or generated-bundle evidence exists in this folder. Such tests are written in the repository but remain unexecuted in this environment.
