# AGENTS.md

## Project

ArmaMCP is a local-first MVP bridge between Codex and Arma 3 Eden Editor:

- TypeScript MCP sidecar over STDIO.
- Local HTTP bridge bound to `127.0.0.1`.
- Small native `ArmaMCP_x64` extension that forwards `callExtension` commands to the bridge.
- HEMTT addon with SQF functions for Eden snapshots and structured editor plan application.

## Source Of Truth

- Follow `plans/arma_mcp_codex_mvp_plans/` for the current MVP.
- The `plans/` tree is source material only and must stay untracked.
- Do not add `plans/` to `.gitignore`, `.git/info/exclude`, `.git/config`, or any global ignore.
- Do not stage `plans/`; use pathspec exclusions such as:

```bash
git add . ':!plans' ':!plans/**'
```

## Safety Rules

- Keep the bridge local-only on `127.0.0.1`.
- Require bearer-token auth on bridge endpoints.
- Do not commit API keys, durable bearer tokens, mission secrets, or generated local credentials.
- Do not expose arbitrary SQF execution, shell execution, remote execution, or destructive editor operations in the MVP.
- Use typed, validated composition plans and dry-runs before queueing Eden changes.
- The native extension should remain a courier, not a decision-maker.

## Development

- Sidecar code lives in `sidecar/` and should keep STDIO clean: MCP messages on stdout, logs on stderr.
- Addon code lives in `addons/main/` and should avoid gameplay work unless running in Eden/editor contexts.
- Extension code lives in `extension/` and must fail fast with short localhost HTTP timeouts.
- Prefer vanilla fallback Arma classnames for the initial checkpoint generator.
- Keep implementation changes scoped to the current plan stage.

## Validation

Run the strongest available checks for the touched stage:

```bash
cd sidecar && npm run validate
cd .. && hemtt dev
./scripts/build-extension.sh
./scripts/validate.sh
git status --short --untracked-files=all
git check-ignore -v plans || true
```

If a toolchain is missing, document the exact command and failure in `IMPLEMENTATION_REPORT.md`.

## Commit Requirements

- Commit after each completed stage.
- GPG-sign every commit.
- Include this trailer in every commit message:

```text
Co-authored-by: Codex <codex@openai.com>
```

- Never commit files under `plans/`.
