# Known Limitations

- The sidecar state is in-memory only.
- The addon assumes current Arma 3 scripting support for `fromJSON` and `toJSON`.
- The extension reads bearer tokens from `ArmaMCP.ini` beside the extension, with environment variables as a fallback.
- There is no asset index, mesh parsing, collision validation, road detection, or faction-aware object catalog yet.
- Terrain sampling is approximate and limited to grid height, water, and slope checks.
- The procedural generators use vanilla fallback classnames.
- Marker creation is implemented through `create3DENEntity ["Marker", ...]` and still needs an in-game Eden smoke test.
- Trigger/module/waypoint creation is available through the shared batch path but still needs a full in-game Eden smoke test for exact 3DEN attribute names.
- Layer assignment is represented in generated plans but not fully wired to Eden layer commands yet.
- Sync/group connection operations are reserved in the protocol and validation path but not fully implemented.
- HEMTT `dev` may fail after successful build if it cannot deploy into the local Arma installation.
- BattleEye/public-server deployment and admin authority controls are future work.
