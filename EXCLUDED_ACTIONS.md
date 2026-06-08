# EXCLUDED_ACTIONS.md

ArmaMCP is local Eden editor tooling. The actions below are intentionally outside the MVP action manifest unless a future plan adds a separate security model.

## Raw SQF Execution

Excluded names:

- `arma.raw.eval_sqf`
- `arma.raw.run_sqf`
- `arma.sqf.exec`
- `arma.debug.eval`

Reason: unbounded SQF execution bypasses typed schemas, dry-runs, confirmation checks, and policy review. Use typed Eden tools instead.

## Multiplayer And Server Administration

Excluded names:

- `arma.server.remoteExec`
- `arma.server.kick`
- `arma.server.ban`
- `arma.server.restart`
- `arma.server.spawnLive`
- `arma.zeus.grant`

Reason: public multiplayer and server-admin capabilities need separate authentication, audit logging, whitelists, and permissions.

## Public Network Bridge

Excluded behaviors:

- binding the bridge to `0.0.0.0` by default
- accepting unauthenticated bridge requests
- publishing the local bridge through public tunnels by default

Reason: the localhost bearer-token boundary is intentional for this local-first bridge.

## Asset Or Terrain Mutation

Excluded behaviors:

- editing P3D mesh files
- editing terrain files
- unpacking protected third-party assets

Reason: asset mutation is a separate tooling domain with different IP and safety risks.

## Future-Only Candidates

These may be built later under stricter scopes:

- server-admin MCP
- mod asset indexing tools that unpack protected content
- P3D source asset analyzers
- CI mission linter
