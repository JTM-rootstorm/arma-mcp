params [
    ["_params", createHashMap]
];

private _dryRun = _params getOrDefault ["dryRun", true];
private _entityType = _params getOrDefault ["type", "Object"];
private _className = _params getOrDefault ["className", ""];
private _transform = _params getOrDefault ["transform", createHashMap];
private _attributes = _params getOrDefault ["attributes", createHashMap];
private _select = _params getOrDefault ["select", true];
private _positionATL = _transform getOrDefault ["positionATL", [0, 0, 0]];
private _warnings = [];

if (_entityType in ["Object", "Logic", "Module"] && {!isClass (configFile >> "CfgVehicles" >> _className)}) then {
    _warnings pushBack format ["Class %1 is not present in CfgVehicles", _className];
};

if (_dryRun) exitWith {
    createHashMapFromArray [
        ["dryRun", true],
        ["planned", [createHashMapFromArray [
            ["op", "create_entity"],
            ["type", _entityType],
            ["className", _className],
            ["transform", _transform],
            ["attributes", _attributes]
        ]]],
        ["warnings", _warnings]
    ]
};

private _created = [];
private _entity = objNull;

collect3DENHistory {
    _entity = create3DENEntity [_entityType, _className, _positionATL];
    if (!isNull _entity) then {
        [_entity, _transform] call AMCP_fnc_applyTransform;
        if ((count _attributes) > 0) then {
            [_entity, _attributes] call AMCP_fnc_applyAttributes;
        };
        private _edenId = [_entity, _entityType] call AMCP_fnc_registerEntity;
        _created pushBack createHashMapFromArray [
            ["edenId", _edenId],
            ["type", _entityType],
            ["className", _className]
        ];
        if (_select) then {
            set3DENSelected [_entity];
        };
    };
};

createHashMapFromArray [
    ["dryRun", false],
    ["created", _created],
    ["warnings", _warnings]
]
