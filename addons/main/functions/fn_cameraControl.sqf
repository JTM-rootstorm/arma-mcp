params [
    ["_operation", "", [""]],
    ["_params", createHashMap]
];

private _safeSegment = {
    params [["_input", "", [""]]];
    private _chars = toArray _input;
    private _out = [];
    {
        private _ok = (_x >= 48 && {_x <= 57}) || {(_x >= 65 && {_x <= 90}) || {(_x >= 97 && {_x <= 122}) || {_x in [45, 46, 95]}}};
        _out pushBack ([95, _x] select _ok);
    } forEach _chars;
    private _result = toString _out;
    if (_result isEqualTo "") exitWith {"capture"};
    _result
};

private _cleanup = {
    private _camera = missionNamespace getVariable ["AMCP_previewCamera", objNull];
    if (!isNull _camera) then {
        _camera cameraEffect ["terminate", "back"];
        camDestroy _camera;
    };
    {
        if (!isNull _x) then {
            deleteVehicle _x;
        };
    } forEach (missionNamespace getVariable ["AMCP_previewObjects", []]);
    missionNamespace setVariable ["AMCP_previewCamera", objNull];
    missionNamespace setVariable ["AMCP_previewObjects", []];
    missionNamespace setVariable ["AMCP_previewScene", createHashMap];
};

private _number = {
    params ["_value", "_default"];
    if (_value isEqualType 0 && {finite _value}) exitWith {_value};
    _default
};

private _vector = {
    params ["_value", "_default"];
    if !(_value isEqualType []) exitWith {_default};
    if ((count _value) < 3) exitWith {_default};
    private _candidate = [_value select 0, _value select 1, _value select 2];
    if (_candidate findIf {!(_x isEqualType 0) || {!finite _x}} >= 0) exitWith {_default};
    _candidate
};

private _angleOffset = {
    params ["_angle", "_distance", "_height"];
    switch (toLowerANSI _angle) do {
        case "front": {[0, -_distance, _height]};
        case "back": {[0, _distance, _height]};
        case "rear": {[0, _distance, _height]};
        case "left": {[-_distance, 0, _height]};
        case "right": {[_distance, 0, _height]};
        case "top": {[0, -0.1, _distance max _height]};
        case "iso": {[_distance * 0.8, -_distance * 0.8, _height]};
        default {[0, -_distance, _height]};
    }
};

private _ensureCamera = {
    params ["_target", "_cameraPos", "_fov", "_commitTime"];
    private _camera = missionNamespace getVariable ["AMCP_previewCamera", objNull];
    if (isNull _camera) then {
        _camera = "camera" camCreate _cameraPos;
        _camera cameraEffect ["internal", "back"];
        showCinemaBorder false;
        missionNamespace setVariable ["AMCP_previewCamera", _camera];
    };
    _camera camPrepareTarget _target;
    _camera camPreparePos _cameraPos;
    _camera camPrepareFov _fov;
    _camera camCommitPrepared _commitTime;
    waitUntil {camCommitted _camera};
    _camera
};

private _capture = {
    params ["_filename"];
    private _ok = screenshot _filename;
    uiSleep 0.25;
    _ok
};

if (_operation isEqualTo "destroyPreviewScene") exitWith {
    [] call _cleanup;
    createHashMapFromArray [
        ["ok", true],
        ["destroyed", true]
    ]
};

if (_operation isEqualTo "captureCurrentView") exitWith {
    private _runId = _params getOrDefault ["runId", format ["amcp_%1", diag_tickTime]];
    private _fileName = _params getOrDefault ["filename", format ["arma-mcp\%1\current.png", [_runId] call _safeSegment]];
    private _ok = [_fileName] call _capture;
    createHashMapFromArray [
        ["ok", _ok],
        ["status", ["failed", "captured"] select _ok],
        ["screenshots", [createHashMapFromArray [
            ["angle", "current"],
            ["filename", _fileName],
            ["profile_relative_path", _fileName],
            ["captured", _ok]
        ]]]
    ]
};

private _className = _params getOrDefault ["className", ""];
private _vehicleConfig = configFile >> "CfgVehicles" >> _className;
if (_className isEqualTo "" || {!(isClass _vehicleConfig)}) exitWith {
    createHashMapFromArray [
        ["ok", false],
        ["status", "failed"],
        ["error", "class_not_found"],
        ["class_name", _className]
    ]
};

private _runId = _params getOrDefault ["runId", format ["amcp_%1", diag_tickTime]];
private _angles = _params getOrDefault ["angles", ["front", "left", "right", "back", "top", "iso"]];
private _anchor = [_params getOrDefault ["positionATL", [0, 0, 0]], [0, 0, 0]] call _vector;
private _dir = [_params getOrDefault ["dir", 0], 0] call _number;
private _distance = [_params getOrDefault ["distance", 8], 8] call _number;
private _height = [_params getOrDefault ["height", 2.2], 2.2] call _number;
private _fov = [_params getOrDefault ["fov", 0.7], 0.7] call _number;
private _settleSeconds = [_params getOrDefault ["settleSeconds", 0.25], 0.25] call _number;
private _safeClass = [_className] call _safeSegment;
private _safeRun = [_runId] call _safeSegment;

[] call _cleanup;

private _obj = createVehicleLocal [_className, _anchor, [], 0, "CAN_COLLIDE"];
if (isNull _obj) exitWith {
    createHashMapFromArray [
        ["ok", false],
        ["status", "failed"],
        ["error", "createVehicleLocal_failed"],
        ["class_name", _className]
    ]
};
_obj setDir _dir;
_obj enableSimulation false;
missionNamespace setVariable ["AMCP_previewObjects", [_obj]];

private _center = getPosATL _obj;
private _bb = boundingBoxReal _obj;
private _min = _bb param [0, [0, 0, 0]];
private _max = _bb param [1, [0, 0, 0]];
private _target = [
    (_center select 0),
    (_center select 1),
    (_center select 2) + (((_max select 2) max 0.5) / 2)
];
private _screenshots = [];

{
    private _angle = _x;
    private _offset = [_angle, _distance, _height] call _angleOffset;
    private _cameraPos = [
        (_target select 0) + (_offset select 0),
        (_target select 1) + (_offset select 1),
        (_target select 2) + (_offset select 2)
    ];
    [_target, _cameraPos, _fov, 0] call _ensureCamera;
    uiSleep _settleSeconds;
    private _filename = format ["arma-mcp\%1\%2_%3.png", _safeRun, _safeClass, [_angle] call _safeSegment];
    private _captured = true;
    if (_operation in ["captureClassAngles", "inspectClass"]) then {
        _captured = [_filename] call _capture;
    };
    _screenshots pushBack (createHashMapFromArray [
        ["angle", _angle],
        ["filename", _filename],
        ["profile_relative_path", _filename],
        ["captured", _captured],
        ["camera_position", _cameraPos],
        ["camera_target", _target]
    ]);
} forEach _angles;

private _scene = createHashMapFromArray [
    ["class_name", _className],
    ["run_id", _runId],
    ["target", _target],
    ["object_position", getPosATL _obj],
    ["distance", _distance],
    ["height", _height],
    ["fov", _fov]
];
missionNamespace setVariable ["AMCP_previewScene", _scene];

if (_operation in ["captureClassAngles", "inspectClass"]) then {
    [] call _cleanup;
};

createHashMapFromArray [
    ["ok", true],
    ["status", ["preview", "captured"] select (_operation in ["captureClassAngles", "inspectClass"])],
    ["class_name", _className],
    ["run_id", _runId],
    ["screenshots", _screenshots],
    ["scene", _scene],
    ["profile_screenshots_root", "profile:Screenshots"]
]
