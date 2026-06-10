params [
    ["_params", createHashMap]
];

private _dryRun = _params getOrDefault ["dryRun", true];
private _entityType = _params getOrDefault ["type", "Object"];
private _className = _params getOrDefault ["className", ""];
private _transform = _params getOrDefault ["transform", createHashMap];
private _attributes = +(_params getOrDefault ["attributes", createHashMap]);
private _select = _params getOrDefault ["select", true];
private _positionATL = _transform getOrDefault ["positionATL", [0, 0, 0]];
private _warnings = [];

if (_entityType isEqualTo "Marker") then {
    {
        private _field = _x;
        if (_params getOrDefault [_field, ""] isNotEqualTo "" && {isNil {_attributes get _field}}) then {
            _attributes set [_field, _params get _field];
        };
    } forEach ["text", "markerType", "color", "shape", "brush"];
    if (!isNil {_params get "alpha"} && {isNil {_attributes get "alpha"}}) then {_attributes set ["alpha", _params get "alpha"]};
    if (!isNil {_params get "size"} && {isNil {_attributes get "size"}}) then {_attributes set ["size", _params get "size"]};
    if (!isNil {_params get "angle"} && {isNil {_attributes get "angle"}}) then {_attributes set ["angle", _params get "angle"]};
    if (_className isEqualTo "") then {
        _className = _attributes getOrDefault ["markerType", "mil_dot"];
    };
};

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
private _creationType = [_entityType, "Logic"] select (_entityType isEqualTo "Module");

collect3DENHistory {
    _entity = create3DENEntity [_creationType, _className, _positionATL];
    private _createdOk = if (_entityType isEqualTo "Marker") then {
        _entity isEqualType "" && {_entity isNotEqualTo ""}
    } else {
        _entity isEqualType objNull && {_entity isNotEqualTo objNull}
    };
    if (_createdOk) then {
        [_entity, _transform] call AMCP_fnc_applyTransform;
        if ((count _attributes) > 0) then {
            [_entity, _attributes] call AMCP_fnc_applyAttributes;
        };
        private _edenId = [_entity, _entityType] call AMCP_fnc_registerEntity;
        private _layer = _params getOrDefault ["layer", ""];
        if (_layer isNotEqualTo "") then {
            private _layerParams = createHashMapFromArray [
                ["dryRun", false],
                ["entityIds", [_edenId]],
                ["layer", if (_layer isEqualType "") then {
                    createHashMapFromArray [["name", _layer], ["createIfMissing", true], ["parentLayerId", -1]]
                } else {
                    _layer
                }]
            ];
            private _layerResult = ["assign", _layerParams] call AMCP_fnc_layerOps;
            _warnings append (_layerResult getOrDefault ["warnings", []]);
        };
        _created pushBack createHashMapFromArray [
            ["edenId", _edenId],
            ["type", _entityType],
            ["className", _className],
            ["groupId", if (_entity isEqualType objNull && {!isNull (group _entity)}) then {[(group _entity), "Group"] call AMCP_fnc_registerEntity} else {""}]
        ];
        if (_select && {_entity isEqualType objNull}) then {
            set3DENSelected [_entity];
        };
    } else {
        _warnings pushBack format ["Failed to create %1 %2", _entityType, _className];
    };
};

createHashMapFromArray [
    ["dryRun", false],
    ["created", _created],
    ["warnings", _warnings]
]
