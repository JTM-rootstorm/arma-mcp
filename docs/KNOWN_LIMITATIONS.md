# Known Limitations

- The sidecar state is in-memory only.
- The addon assumes current Arma 3 scripting support for `fromJSON` and `toJSON`.
- The extension reads bearer tokens from `ArmaMCP.ini` beside the extension, with environment variables as a fallback.
- There is no asset index, mesh parsing, collision validation, road detection, terrain sampling, or faction-aware object catalog yet.
- The checkpoint generator uses vanilla fallback classnames.
- Marker creation is implemented through `create3DENEntity ["Marker", ...]` and still needs an in-game Eden smoke test.
- HEMTT `dev` may fail after successful build if it cannot deploy into the local Arma installation.
- BattleEye/public-server deployment, audit logs, and admin authority controls are future work.
