if (!hasInterface) exitWith {};
if (!is3DEN) exitWith {};

["Starting Eden bridge poll loop"] call AMCP_fnc_log;

while {hasInterface && is3DEN} do {
    private _result = ["pollCommands"] call AMCP_fnc_callBridge;
    if ((_result select [0, 3]) isEqualTo "OK:") then {
        private _json = _result select [3];
        if (_json isNotEqualTo "") then {
            private _body = fromJSON _json;
            if (isNil "_body") then {
                private _lastParseWarning = missionNamespace getVariable ["AMCP_lastPollParseWarningAt", -10];
                if ((time - _lastParseWarning) > 10) then {
                    missionNamespace setVariable ["AMCP_lastPollParseWarningAt", time];
                    [format [
                        "Failed to parse bridge command JSON (%1 chars): %2",
                        count _json,
                        _json select [0, 500]
                    ]] call AMCP_fnc_log;
                };
            } else {
                private _commands = _body getOrDefault ["commands", []];
                {
                    if ((_x getOrDefault ["schemaVersion", 0]) isEqualTo 1 && {(_x getOrDefault ["action", ""]) isNotEqualTo ""}) then {
                        [_x] call AMCP_fnc_dispatchAction;
                    } else {
                        [_x] call AMCP_fnc_applyPlan;
                    };
                } forEach _commands;
            };
        };
    };
    sleep 1;
};

["Stopped Eden bridge poll loop"] call AMCP_fnc_log;
