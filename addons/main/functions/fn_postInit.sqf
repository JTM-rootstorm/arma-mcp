if (!hasInterface) exitWith {};

[] spawn {
    waitUntil {sleep 0.5; !isNull findDisplay 313 || {is3DEN}};
    if (!is3DEN) exitWith {
        ["postInit skipped outside Eden"] call AMCP_fnc_log;
    };

    ["ArmaMCP Eden bridge initialized"] call AMCP_fnc_log;
    missionNamespace setVariable ["AMCP_lastSelectionSnapshotAt", -10];

    add3DENEventHandler ["OnSelectionChange", {
        private _last = missionNamespace getVariable ["AMCP_lastSelectionSnapshotAt", -10];
        if ((time - _last) > 2) then {
            missionNamespace setVariable ["AMCP_lastSelectionSnapshotAt", time];
            [] spawn AMCP_fnc_captureSelection;
        };
    }];

    [] spawn AMCP_fnc_pollCommands;
};
