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
    private _warnings = _attributeResult getOrDefault ["warnings", []];
    if ((count _warnings) > 0) then {
        _snapshot set ["warnings", _warnings];
    };
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
