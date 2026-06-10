params [
    ["_entity", objNull],
    ["_entityType", "Object", [""]],
    ["_options", createHashMap]
];

private _includeAttributes = _options getOrDefault ["includeAttributes", true];
private _includeConfig = _options getOrDefault ["includeConfig", true];
private _includeModel = _options getOrDefault ["includeModel", false];
private _attributeNames = _options getOrDefault ["attributeNames", []];

private _edenId = [_entity, _entityType] call AMCP_fnc_registerEntity;
private _className = "";
private _variableName = "";
private _displayName = "";
private _positionATL = [0, 0, 0];
private _positionASL = [0, 0, 0];
private _dir = 0;
private _vectorDir = [0, 1, 0];
private _vectorUp = [0, 0, 1];
private _modelPath = "";
private _bounds = createHashMapFromArray [["min", [0, 0, 0]], ["max", [0, 0, 0]]];
private _warnings = [];
private _firstAttributeValue = {
    params ["_target", "_name", "_fallback"];
    private _value = _target get3DENAttribute _name;
    if (_value isEqualType [] && {_value isNotEqualTo []}) then {
        _value = _value select 0;
    };
    if (isNil "_value") exitWith {_fallback};
    if (_value isEqualType _fallback) exitWith {_value};
    _fallback
};

if (_entity isEqualType objNull) then {
    _className = typeOf _entity;
    _variableName = ((_entity get3DENAttribute "Name") param [0, ""]);
    _displayName = getText (configFile >> "CfgVehicles" >> _className >> "displayName");
    _positionATL = getPosATL _entity;
    _positionASL = getPosASL _entity;
    _dir = getDir _entity;
    _vectorDir = vectorDir _entity;
    _vectorUp = vectorUp _entity;
    private _modelInfo = getModelInfo _entity;
    _modelPath = _modelInfo param [1, ""];
    private _box = boundingBoxReal _entity;
    _bounds = createHashMapFromArray [
        ["min", _box param [0, [0, 0, 0]]],
        ["max", _box param [1, [0, 0, 0]]]
    ];
} else {
    if (_entity isEqualType "") then {
        private _markerRecord = (missionNamespace getVariable ["AMCP_markerMetadata", createHashMap]) getOrDefault [_entity, createHashMap];
        private _markerValue = {
            params ["_name", "_fallback"];
            private _missing = "__AMCP_MARKER_METADATA_MISSING__";
            private _value = _markerRecord getOrDefault [_name, _missing];
            if (_value isEqualTo _missing) exitWith {_fallback};
            if (_value isEqualType _fallback) exitWith {_value};
            _fallback
        };
        _className = ["markerType", [_entity, "markerType", markerType _entity] call _firstAttributeValue] call _markerValue;
        _variableName = _entity;
        _displayName = ["text", [_entity, "text", markerText _entity] call _firstAttributeValue] call _markerValue;
        _positionATL = ["positionATL", [_entity, "position", markerPos _entity] call _firstAttributeValue] call _markerValue;
        _positionASL = ATLToASL _positionATL;
        _dir = ["angle", [_entity, "angle", markerDir _entity] call _firstAttributeValue] call _markerValue;
    } else {
        if (_entity isEqualType grpNull) then {
            _variableName = groupId _entity;
            _displayName = groupId _entity;
            private _leader = leader _entity;
            if (!isNull _leader) then {
                _positionATL = getPosATL _leader;
                _positionASL = getPosASL _leader;
                _dir = getDir _leader;
            } else {
                _warnings pushBack "Group has no live leader position; transform is advisory.";
            };
            _className = "Group";
        } else {
            if (_entity isEqualType []) then {
                private _group = _entity param [0, grpNull];
                private _index = _entity param [1, -1];
                _className = waypointType _entity;
                _variableName = format ["%1:%2", groupId _group, _index];
                _displayName = _className;
                private _positionAttribute = _entity get3DENAttribute "position";
                _positionATL = _positionAttribute param [0, waypointPosition _entity];
                _positionASL = ATLToASL _positionATL;
            } else {
                if (_entity isEqualType 0) then {
                    _className = "Layer";
                    _variableName = format ["%1", _entity];
                    _displayName = format ["Layer %1", _entity];
                    _warnings pushBack "Layer display names are not fully exposed by this snapshot path; use layerId for stable in-session references.";
                } else {
                    _warnings pushBack format ["Snapshot type %1 has limited field support.", typeName _entity];
                };
            };
        };
    };
};

private _snapshot = createHashMapFromArray [
    ["edenId", _edenId],
    ["type", _entityType],
    ["className", _className],
    ["variableName", _variableName],
    ["displayName", _displayName],
    [
        "transform",
        createHashMapFromArray [
            ["positionATL", _positionATL],
            ["positionASL", _positionASL],
            ["dir", _dir],
            ["vectorDir", _vectorDir],
            ["vectorUp", _vectorUp]
        ]
    ]
];

if (_includeAttributes) then {
    private _attributeResult = [_entity, _entityType, _attributeNames] call AMCP_fnc_readEntityAttributes;
    _snapshot set ["attributes", _attributeResult getOrDefault ["attributes", createHashMap]];
    _warnings append (_attributeResult getOrDefault ["warnings", []]);
};

if (_entityType isEqualTo "Marker") then {
    private _markerRecord = (missionNamespace getVariable ["AMCP_markerMetadata", createHashMap]) getOrDefault [_entity, createHashMap];
    private _markerValue = {
        params ["_name", "_fallback"];
        private _missing = "__AMCP_MARKER_METADATA_MISSING__";
        private _value = _markerRecord getOrDefault [_name, _missing];
        if (_value isEqualTo _missing) exitWith {_fallback};
        if (_value isEqualType _fallback) exitWith {_value};
        _fallback
    };
    _snapshot set ["marker", createHashMapFromArray [
        ["text", ["text", [_entity, "text", markerText _entity] call _firstAttributeValue] call _markerValue],
        ["type", ["markerType", [_entity, "markerType", markerType _entity] call _firstAttributeValue] call _markerValue],
        ["color", ["color", [_entity, "color", markerColor _entity] call _firstAttributeValue] call _markerValue],
        ["shape", ["shape", [_entity, "shape", markerShape _entity] call _firstAttributeValue] call _markerValue],
        ["size", ["size", [_entity, "size", markerSize _entity] call _firstAttributeValue] call _markerValue],
        ["alpha", ["alpha", [_entity, "alpha", markerAlpha _entity] call _firstAttributeValue] call _markerValue],
        ["dir", ["angle", [_entity, "angle", markerDir _entity] call _firstAttributeValue] call _markerValue]
    ]];
};

if (_entityType isEqualTo "Group" && {_entity isEqualType grpNull}) then {
    private _unitIds = [];
    {
        _unitIds pushBack ([_x, "Object"] call AMCP_fnc_registerEntity);
    } forEach (units _entity);
    _snapshot set ["group", createHashMapFromArray [
        ["groupId", groupId _entity],
        ["unitIds", _unitIds],
        ["side", str (side _entity)]
    ]];
};

if (_entityType isEqualTo "Waypoint" && {_entity isEqualType []}) then {
    private _group = _entity param [0, grpNull];
    private _positionAttribute = _entity get3DENAttribute "position";
    private _positionATL = _positionAttribute param [0, waypointPosition _entity];
    _snapshot set ["waypoint", createHashMapFromArray [
        ["groupId", if (_group isEqualType grpNull) then {[_group, "Group"] call AMCP_fnc_registerEntity} else {""}],
        ["index", _entity param [1, -1]],
        ["type", waypointType _entity],
        ["positionATL", _positionATL]
    ]];
};

if (_entityType isEqualTo "Layer" && {_entity isEqualType 0}) then {
    private _childIds = [];
    {
        private _childType = typeName _x;
        private _childId = if (_x isEqualType objNull) then {
            [_x, ["Object", "Logic"] select (_x isKindOf "Logic")] call AMCP_fnc_registerEntity
        } else {
            if (_x isEqualType grpNull) then {
                [_x, "Group"] call AMCP_fnc_registerEntity
            } else {
                if (_x isEqualType []) then {
                    [_x, "Waypoint"] call AMCP_fnc_registerEntity
                } else {
                    if (_x isEqualType "") then {
                        [_x, "Marker"] call AMCP_fnc_registerEntity
                    } else {
                        str _x
                    };
                };
            };
        };
        _childIds pushBack createHashMapFromArray [["edenId", _childId], ["rawType", _childType]];
    } forEach (get3DENLayerEntities _entity);
    _snapshot set ["layer", createHashMapFromArray [
        ["layerId", _entity],
        ["children", _childIds]
    ]];
};

if (_warnings isNotEqualTo []) then {
    _snapshot set ["warnings", _warnings];
};

if (_includeConfig) then {
    private _config = createHashMap;
    if (_className isNotEqualTo "") then {
        private _vehicleConfig = configFile >> "CfgVehicles" >> _className;
        if (isClass _vehicleConfig) then {
            _config set ["displayName", getText (_vehicleConfig >> "displayName")];
            _config set ["faction", getText (_vehicleConfig >> "faction")];
            _config set ["editorCategory", getText (_vehicleConfig >> "editorCategory")];
            _config set ["editorSubcategory", getText (_vehicleConfig >> "editorSubcategory")];
            _config set ["side", getNumber (_vehicleConfig >> "side")];
        };
    };
    _snapshot set ["config", _config];
};

if (_includeModel) then {
    _snapshot set [
        "model",
        createHashMapFromArray [
            ["modelPath", _modelPath],
            ["bounds", _bounds]
        ]
    ];
};

_snapshot
