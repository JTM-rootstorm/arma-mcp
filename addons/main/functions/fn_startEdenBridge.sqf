if (!hasInterface) exitWith {};

if (!is3DEN) exitWith {
    ["Eden bridge start skipped outside Eden"] call AMCP_fnc_log;
};

if (missionNamespace getVariable ["AMCP_edenBridgeStarted", false]) exitWith {};
missionNamespace setVariable ["AMCP_edenBridgeStarted", true];
missionNamespace setVariable ["AMCP_lastSelectionSnapshotAt", -10];

["ArmaMCP Eden bridge initialized"] call AMCP_fnc_log;

add3DENEventHandler ["OnSelectionChange", {
    private _last = missionNamespace getVariable ["AMCP_lastSelectionSnapshotAt", -10];
    if ((time - _last) > 2) then {
        missionNamespace setVariable ["AMCP_lastSelectionSnapshotAt", time];
        [] spawn AMCP_fnc_captureSelection;
    };
}];

[] spawn AMCP_fnc_pollCommands;
