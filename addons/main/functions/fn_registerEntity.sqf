params [
    ["_entity", objNull],
    ["_entityType", "Object", [""]]
];

if (isNil {missionNamespace getVariable "AMCP_entityRegistry"}) then {
    missionNamespace setVariable ["AMCP_entityRegistry", createHashMap];
};
if (isNil {missionNamespace getVariable "AMCP_entityCounter"}) then {
    missionNamespace setVariable ["AMCP_entityCounter", 0];
};

private _registry = missionNamespace getVariable ["AMCP_entityRegistry", createHashMap];
private _existing = "";

if (_entity isEqualType objNull) then {
    _existing = _entity getVariable ["AMCP_bridgeId", ""];
};
if (_entity isEqualType grpNull) then {
    _existing = _entity getVariable ["AMCP_bridgeId", ""];
};

if (_existing isEqualTo "") then {
    private _prefix = format ["eden:%1:", toLower _entityType];
    {
        if ((_x find _prefix) isEqualTo 0 && {(_registry get _x) isEqualTo _entity}) exitWith {
            _existing = _x;
        };
    } forEach (keys _registry);
};

if (_existing isEqualTo "") then {
    private _counter = (missionNamespace getVariable ["AMCP_entityCounter", 0]) + 1;
    missionNamespace setVariable ["AMCP_entityCounter", _counter];
    _existing = format ["eden:%1:%2", toLower _entityType, _counter];
    if (_entity isEqualType objNull) then {
        _entity setVariable ["AMCP_bridgeId", _existing];
    };
    if (_entity isEqualType grpNull) then {
        _entity setVariable ["AMCP_bridgeId", _existing];
    };
};

_registry set [_existing, _entity];
missionNamespace setVariable ["AMCP_entityRegistry", _registry];
_existing
