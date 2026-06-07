params [
    ["_edenId", "", [""]]
];

private _registry = missionNamespace getVariable ["AMCP_entityRegistry", createHashMap];
_registry getOrDefault [_edenId, objNull]
