params [
    ["_verb", "", [""]],
    ["_payload", "", [""]]
];

if (_verb isEqualTo "") exitWith {
    ["callBridge called without a verb"] call AMCP_fnc_log;
    "ERR:missing_verb"
};

private _command = _verb;
if (_payload isNotEqualTo "") then {
    _command = format ["%1:%2", _verb, _payload];
};

private _result = "ArmaMCP_x64" callExtension _command;
if ((_result select [0, 4]) isEqualTo "ERR:") then {
    private _lastWarning = missionNamespace getVariable ["AMCP_lastBridgeWarningAt", -10];
    if ((time - _lastWarning) > 10) then {
        missionNamespace setVariable ["AMCP_lastBridgeWarningAt", time];
        [format ["Bridge call failed for %1: %2", _verb, _result]] call AMCP_fnc_log;
    };
};

_result
