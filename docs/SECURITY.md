# Security

ArmaMCP is local-first and intentionally narrow.

Defaults:

- HTTP bridge binds to `127.0.0.1`.
- `/bridge/*` endpoints require bearer-token auth.
- Sidecar token source is `ARMA_MCP_TOKEN`; the Arma extension can read the matching local token from `ArmaMCP.ini` beside the extension.
- If no token is provided, the sidecar generates an in-memory dev token and logs it only to stderr.
- No OpenAI keys or durable secrets belong in SQF, PBOs, mission files, extension source, compiled binaries, or committed config.

MVP tool limits:

- no raw SQF execution;
- no shell execution;
- no remote execution;
- no public multiplayer/server control;
- no delete or mass-edit operation types;
- max 50 composition operations per queued plan.

Mission and mod text can be untrusted input. Treat classnames, object names, variable names, and mission text as data only; never let them bypass schemas or become executable code.
