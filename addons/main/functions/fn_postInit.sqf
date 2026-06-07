if (!hasInterface) exitWith {};

[] spawn {
    waitUntil {sleep 0.5; !isNull findDisplay 313 || {is3DEN}};
    [] call AMCP_fnc_startEdenBridge;
};
