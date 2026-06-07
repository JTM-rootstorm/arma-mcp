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
- destructive delete operations require explicit confirmation when `dryRun=false`;
- init and statement fields are allowlisted and scanned for risky scripting patterns;
- max 250 typed batch operations per queued plan;
- write actions are recorded in the in-memory bridge audit/event log.
- HEMTT release PBOs are signed and include a public `.bikey` for validation.

Mission and mod text can be untrusted input. Treat classnames, object names, variable names, and mission text as data only; never let them bypass schemas or become executable code.
