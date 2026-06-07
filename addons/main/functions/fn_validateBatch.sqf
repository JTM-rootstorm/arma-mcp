params [
    ["_params", createHashMap]
];

private _operations = _params getOrDefault ["operations", []];
private _dryRun = _params getOrDefault ["dryRun", true];
private _confirmation = _params getOrDefault ["confirmation", createHashMap];
private _confirmed = _confirmation getOrDefault ["confirmed", false];
private _errors = [];
private _warnings = _params getOrDefault ["policyWarnings", []];
private _stats = createHashMapFromArray [
    ["create", 0],
    ["update", 0],
    ["delete", 0],
    ["select", 0]
];

if ((count _operations) > 250) then {
    _errors pushBack createHashMapFromArray [
        ["code", "TOO_MANY_OPERATIONS"],
        ["message", "Batch operation limit is 250"]
    ];
};

{
    private _op = _x getOrDefault ["op", ""];
    if (_op in ["create_entity", "create_marker", "create_trigger", "create_waypoint", "create_module"]) then {
        _stats set ["create", (_stats get "create") + 1];
        private _className = _x getOrDefault ["className", ""];
        private _type = _x getOrDefault ["type", "Object"];
        if (_className isEqualTo "") then {
            _errors pushBack createHashMapFromArray [
                ["code", "MISSING_CLASS"],
                ["message", format ["Operation %1 is missing className", _forEachIndex]]
            ];
        };
        if (_type in ["Object", "Logic", "Module"] && {_className isNotEqualTo ""} && {!isClass (configFile >> "CfgVehicles" >> _className)}) then {
            _warnings pushBack format ["Class %1 is not present in CfgVehicles", _className];
        };
    } else {
        if (_op in ["set_transform", "set_attributes", "assign_layer", "sync_entities"]) then {
            _stats set ["update", (_stats get "update") + 1];
            private _entityId = _x getOrDefault ["entityId", ""];
            if (_entityId isNotEqualTo "" && {isNull ([_entityId] call AMCP_fnc_resolveEntity)}) then {
                _errors pushBack createHashMapFromArray [
                    ["code", "ENTITY_NOT_FOUND"],
                    ["message", format ["No live Eden entity is registered as %1", _entityId]]
                ];
            };
        } else {
            if (_op isEqualTo "delete_entity") then {
                _stats set ["delete", (_stats get "delete") + 1];
                if (!_dryRun && {!_confirmed}) then {
                    _errors pushBack createHashMapFromArray [
                        ["code", "CONFIRMATION_REQUIRED"],
                        ["message", "delete_entity requires confirmation when dryRun=false"]
                    ];
                };
            } else {
                if (_op isEqualTo "select_entities") then {
                    _stats set ["select", (_stats get "select") + 1];
                } else {
                    _errors pushBack createHashMapFromArray [
                        ["code", "UNSUPPORTED_OPERATION"],
                        ["message", format ["Unsupported batch operation %1", _op]]
                    ];
                };
            };
        };
    };
} forEach _operations;

createHashMapFromArray [
    ["valid", (count _errors) isEqualTo 0],
    ["errors", _errors],
    ["warnings", _warnings],
    ["stats", _stats]
]
