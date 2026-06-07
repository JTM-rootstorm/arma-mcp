if (!hasInterface) exitWith { false };
if (!is3DEN) exitWith { false };

private _selected = get3DENSelected "object";
private _items = _selected apply { [_x] call AMCP_fnc_buildObjectSnapshot };
private _payload = createHashMapFromArray [
    ["source", "eden"],
    ["sessionId", profileName],
    ["selected", _items],
    ["allCount", count ((all3DENEntities select 0) + (all3DENEntities select 3))]
];

private _json = toJSON _payload;
private _result = ["postSnapshot", _json] call AMCP_fnc_callBridge;
if ((_result select [0, 3]) isEqualTo "OK:") then {
    [format ["Uploaded selection snapshot with %1 object(s)", count _items]] call AMCP_fnc_log;
    true
} else {
    false
}
