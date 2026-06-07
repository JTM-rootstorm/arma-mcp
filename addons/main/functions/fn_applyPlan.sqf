params ["_command"];

if (isNil "_command") exitWith { false };

private _type = _command getOrDefault ["type", ""];

if (_type isEqualTo "requestSnapshot") exitWith {
    [] call AMCP_fnc_captureSelection
};

if (_type isNotEqualTo "applyPlan") exitWith {
    [format ["Ignoring unsupported command type: %1", _type]] call AMCP_fnc_log;
    false
};

private _commandId = _command getOrDefault ["id", ""];
private _plan = _command getOrDefault ["plan", createHashMap];
private _operations = _plan getOrDefault ["operations", []];
private _anchor = _plan getOrDefault ["anchor", createHashMap];
private _anchorMode = _anchor getOrDefault ["mode", "selectionCenter"];
private _selected = get3DENSelected "object";
private _anchorObject = objNull;
if ((count _selected) > 0) then {
    _anchorObject = _selected select 0;
};

private _anchorPos = _anchor getOrDefault ["positionATL", [0, 0, 0]];
private _anchorDir = _anchor getOrDefault ["direction", 0];
if (_anchorMode isEqualTo "selectionCenter" && {!isNull _anchorObject}) then {
    _anchorPos = getPosATL _anchorObject;
    _anchorDir = getDir _anchorObject;
};

private _created = 0;
private _skipped = 0;
private _errors = [];

private _applyOne = {
    params ["_operation"];

    private _opType = _operation getOrDefault ["type", ""];
    private _offset = _operation getOrDefault ["offset", [0, 0, 0]];
    private _dx = _offset param [0, 0];
    private _dy = _offset param [1, 0];
    private _dz = _offset param [2, 0];
    private _sin = sin _anchorDir;
    private _cos = cos _anchorDir;
    private _worldPos = [
        (_anchorPos select 0) + (_dx * _cos) - (_dy * _sin),
        (_anchorPos select 1) + (_dx * _sin) + (_dy * _cos),
        (_anchorPos select 2) + _dz
    ];

    switch (_opType) do {
        case "createObject": {
            private _className = _operation getOrDefault ["className", ""];
            if (_className isEqualTo "") exitWith {
                _errors pushBack "createObject missing className";
                _skipped = _skipped + 1;
            };
            private _entity = create3DENEntity ["Object", _className, _worldPos];
            private _dir = _anchorDir + (_operation getOrDefault ["directionOffset", 0]);
            _entity set3DENAttribute ["rotation", [0, 0, _dir]];
            _created = _created + 1;
        };
        case "createMarker": {
            private _markerType = _operation getOrDefault ["markerType", "mil_dot"];
            private _entity = create3DENEntity ["Marker", _markerType, _worldPos];
            private _text = _operation getOrDefault ["text", ""];
            if (_text isNotEqualTo "") then {
                _entity set3DENAttribute ["text", _text];
            };
            _created = _created + 1;
        };
        default {
            _errors pushBack format ["unsupported operation type %1", _opType];
            _skipped = _skipped + 1;
        };
    };
};

collect3DENHistory {
    {
        [_x] call _applyOne;
    } forEach _operations;
};

private _result = createHashMapFromArray [
    ["commandId", _commandId],
    ["ok", (count _errors) isEqualTo 0],
    ["message", format ["Applied %1 operation(s), skipped %2", _created, _skipped]],
    ["created", _created],
    ["skipped", _skipped],
    ["errors", _errors]
];

["postResult", toJSON _result] call AMCP_fnc_callBridge;
[format ["Applied plan command %1: %2 created, %3 skipped", _commandId, _created, _skipped]] call AMCP_fnc_log;

(count _errors) isEqualTo 0
