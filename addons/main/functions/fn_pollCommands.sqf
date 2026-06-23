if (!hasInterface) exitWith {};
if (!is3DEN) exitWith {};

["Starting Eden bridge poll loop"] call AMCP_fnc_log;

private _pollDelay = 1;
while {hasInterface && is3DEN} do {
    private _result = ["pollCommands"] call AMCP_fnc_callBridge;
    if ((_result select [0, 3]) isEqualTo "OK:") then {
        _pollDelay = 1;
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
                    try {
                        if ((_x getOrDefault ["schemaVersion", 0]) isEqualTo 1 && {(_x getOrDefault ["action", ""]) isNotEqualTo ""}) then {
                            [_x] call AMCP_fnc_dispatchAction;
                        } else {
                            [_x] call AMCP_fnc_applyPlan;
                        };
                    } catch {
                        private _requestId = _x getOrDefault ["requestId", ""];
                        private _action = _x getOrDefault ["action", "eden.batch"];
                        [format ["Command %1 failed in poll loop: %2", _action, _exception]] call AMCP_fnc_log;
                        private _payload = createHashMapFromArray [
                            ["schemaVersion", 1],
                            ["requestId", _requestId],
                            ["ok", false],
                            ["action", _action],
                            ["durationMs", 0],
                            ["warnings", []],
                            ["error", createHashMapFromArray [
                                ["code", "SQF_EXCEPTION"],
                                ["message", str _exception]
                            ]]
                        ];
                        ["postResult", toJSON _payload] call AMCP_fnc_callBridge;
                    };
                } forEach _commands;
            };
        };
    } else {
        _pollDelay = (_pollDelay * 2) min 5;
    };
    sleep _pollDelay;
};

["Stopped Eden bridge poll loop"] call AMCP_fnc_log;
