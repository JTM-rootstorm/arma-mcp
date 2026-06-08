params [
    ["_operation", "", [""]],
    ["_params", createHashMap]
];

private _dryRun = _params getOrDefault ["dryRun", true];
private _warnings = [];
private _created = [];
private _updated = [];
private _deleted = [];
private _missing = [];
private _returnDirect = false;
private _directResult = createHashMap;

private _isMissingObject = {
    params ["_entity"];
    _entity isEqualTo objNull
};

private _resolveGroup = {
    params ["_groupId"];
    private _group = [_groupId] call AMCP_fnc_resolveEntity;
    if (_group isEqualType grpNull) exitWith {_group};
    grpNull
};

private _resolveWaypoint = {
    params ["_waypointId"];
    private _waypoint = [_waypointId] call AMCP_fnc_resolveEntity;
    if (_waypoint isEqualType []) exitWith {_waypoint};
    []
};

private _sideFromName = {
    params ["_sideName"];
    switch (toUpper _sideName) do {
        case "WEST": {west};
        case "BLUFOR": {west};
        case "EAST": {east};
        case "OPFOR": {east};
        case "INDEPENDENT": {independent};
        case "GUER": {independent};
        case "CIVILIAN": {civilian};
        case "CIV": {civilian};
        default {west};
    }
};

private _defaultLeaderClass = {
    params ["_sideName"];
    switch (toUpper _sideName) do {
        case "EAST": {"O_Soldier_F"};
        case "OPFOR": {"O_Soldier_F"};
        case "INDEPENDENT": {"I_Soldier_F"};
        case "GUER": {"I_Soldier_F"};
        case "CIVILIAN": {"C_man_1"};
        case "CIV": {"C_man_1"};
        default {"B_Soldier_F"};
    }
};

private _createUnitInGroup = {
    params ["_group", "_className", "_positionATL"];
    if ((_group isEqualType grpNull) && {!isNull _group}) exitWith {
        _group create3DENEntity ["Object", _className, _positionATL]
    };
    create3DENEntity ["Object", _className, _positionATL]
};

private _waypointRecord = {
    params ["_waypoint"];
    private _attributes = [_waypoint, "Waypoint", []] call AMCP_fnc_readEntityAttributes;
    private _group = _waypoint param [0, grpNull];
    createHashMapFromArray [
        ["edenId", [_waypoint, "Waypoint"] call AMCP_fnc_registerEntity],
        ["groupId", if (_group isEqualType grpNull) then {[_group, "Group"] call AMCP_fnc_registerEntity} else {""}],
        ["index", _waypoint param [1, -1]],
        ["type", waypointType _waypoint],
        ["positionATL", waypointPosition _waypoint],
        ["attributes", _attributes getOrDefault ["attributes", createHashMap]],
        ["warnings", _attributes getOrDefault ["warnings", []]]
    ]
};

switch (_operation) do {
    case "createGroup": {
        private _sideName = _params getOrDefault ["side", "WEST"];
        private _leaderClassName = _params getOrDefault ["leaderClassName", [_sideName] call _defaultLeaderClass];
        private _transform = _params getOrDefault ["transform", createHashMap];
        private _positionATL = _transform getOrDefault ["positionATL", [0, 0, 0]];
        private _attributes = _params getOrDefault ["attributes", createHashMap];
        private _groupAttributes = _params getOrDefault ["groupAttributes", createHashMap];
        private _callsign = _params getOrDefault ["callsign", ""];
        if (_callsign isNotEqualTo "") then {_groupAttributes set ["name", _callsign]};

        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldCreateGroups", 1],
                ["wouldCreateUnits", 1],
                ["side", _sideName],
                ["leaderClassName", _leaderClassName],
                ["warnings", ["Eden group creation uses a leader unit because create3DENEntity has no empty Group mode."]]
            ]
        };

        collect3DENHistory {
            private _unit = create3DENEntity ["Object", _leaderClassName, _positionATL];
            if (!([_unit] call _isMissingObject)) then {
                [_unit, _transform] call AMCP_fnc_applyTransform;
                if ((count _attributes) > 0) then {[_unit, _attributes] call AMCP_fnc_applyAttributes};
                private _group = group _unit;
                if ((count _groupAttributes) > 0) then {[_group, _groupAttributes] call AMCP_fnc_applyAttributes};
                private _groupId = [_group, "Group"] call AMCP_fnc_registerEntity;
                private _unitId = [_unit, "Object"] call AMCP_fnc_registerEntity;
                _created pushBack createHashMapFromArray [
                    ["edenId", _groupId],
                    ["type", "Group"],
                    ["side", str (side _group)],
                    ["leaderUnitId", _unitId]
                ];
                _created pushBack createHashMapFromArray [
                    ["edenId", _unitId],
                    ["type", "Object"],
                    ["className", _leaderClassName],
                    ["groupId", _groupId]
                ];
            };
        };
    };
    case "createUnit": {
        private _groupId = _params getOrDefault ["groupId", ""];
        private _group = [_groupId] call _resolveGroup;
        private _className = _params getOrDefault ["className", "B_Soldier_F"];
        private _transform = _params getOrDefault ["transform", createHashMap];
        private _positionATL = _transform getOrDefault ["positionATL", [0, 0, 0]];
        private _attributes = _params getOrDefault ["attributes", createHashMap];

        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldCreateUnits", 1],
                ["className", _className],
                ["groupId", _groupId],
                ["warnings", _warnings]
            ]
        };

        collect3DENHistory {
            private _unit = [_group, _className, _positionATL] call _createUnitInGroup;
            if (!([_unit] call _isMissingObject)) then {
                [_unit, _transform] call AMCP_fnc_applyTransform;
                if ((count _attributes) > 0) then {[_unit, _attributes] call AMCP_fnc_applyAttributes};
                private _unitGroup = group _unit;
                private _groupOutId = [_unitGroup, "Group"] call AMCP_fnc_registerEntity;
                _created pushBack createHashMapFromArray [
                    ["edenId", [_unit, "Object"] call AMCP_fnc_registerEntity],
                    ["type", "Object"],
                    ["className", _className],
                    ["groupId", _groupOutId]
                ];
            };
        };
    };
    case "assignUnit": {
        private _unitId = _params getOrDefault ["unitId", ""];
        private _groupId = _params getOrDefault ["groupId", ""];
        private _unit = [_unitId] call AMCP_fnc_resolveEntity;
        private _group = [_groupId] call _resolveGroup;
        if ([_unit] call _isMissingObject) then {_missing pushBack _unitId};
        if (isNull _group) then {_missing pushBack _groupId};

        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldAssign", parseNumber ((count _missing) isEqualTo 0)],
                ["missing", _missing],
                ["warnings", ["Existing-unit regrouping uses joinSilent and needs live Eden smoke coverage."]]
            ]
        };

        if ((count _missing) isEqualTo 0) then {
            collect3DENHistory {
                [_unit] joinSilent _group;
            };
            _updated pushBack createHashMapFromArray [["edenId", _unitId], ["groupId", _groupId]];
        };
        _warnings pushBack "Existing-unit regrouping uses joinSilent and needs live Eden smoke coverage.";
    };
    case "listGroupUnits": {
        private _groupId = _params getOrDefault ["groupId", ""];
        private _groups = [];
        if (_groupId isEqualTo "") then {
            _groups = (all3DENEntities param [1, []]);
        } else {
            private _group = [_groupId] call _resolveGroup;
            if (isNull _group) then {_missing pushBack _groupId} else {_groups = [_group]};
        };
        private _links = [];
        {
            private _group = _x;
            private _groupOutId = [_group, "Group"] call AMCP_fnc_registerEntity;
            private _unitIds = [];
            {
                _unitIds pushBack ([_x, "Object"] call AMCP_fnc_registerEntity);
            } forEach (units _group);
            _links pushBack createHashMapFromArray [
                ["groupId", _groupOutId],
                ["side", str (side _group)],
                ["unitIds", _unitIds]
            ];
        } forEach _groups;
        _returnDirect = true;
        _directResult = createHashMapFromArray [
            ["dryRun", false],
            ["groups", _links],
            ["missing", _missing],
            ["warnings", _warnings]
        ];
    };
    case "createWaypoint": {
        private _groupId = _params getOrDefault ["groupId", ""];
        private _group = [_groupId] call _resolveGroup;
        private _className = _params getOrDefault ["className", _params getOrDefault ["type", "MOVE"]];
        private _transform = _params getOrDefault ["transform", createHashMap];
        private _positionATL = _transform getOrDefault ["positionATL", [0, 0, 0]];
        private _attributes = _params getOrDefault ["attributes", createHashMap];
        if (isNull _group) then {_missing pushBack _groupId};

        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldCreateWaypoints", parseNumber ((count _missing) isEqualTo 0)],
                ["groupId", _groupId],
                ["className", _className],
                ["missing", _missing],
                ["warnings", _warnings]
            ]
        };

        if ((count _missing) isEqualTo 0) then {
            collect3DENHistory {
                private _waypoint = _group create3DENEntity ["Waypoint", _className, _positionATL];
                if (_waypoint isEqualType []) then {
                    if ((count _attributes) > 0) then {[_waypoint, _attributes] call AMCP_fnc_applyAttributes};
                    private _record = [_waypoint] call _waypointRecord;
                    _created pushBack createHashMapFromArray [
                        ["edenId", _record get "edenId"],
                        ["type", "Waypoint"],
                        ["className", _className],
                        ["groupId", _record get "groupId"],
                        ["index", _record get "index"]
                    ];
                };
            };
        };
    };
    case "setWaypointAttributes": {
        private _waypointId = _params getOrDefault ["waypointId", _params getOrDefault ["entityId", ""]];
        private _waypoint = [_waypointId] call _resolveWaypoint;
        if ((count _waypoint) isEqualTo 0) then {_missing pushBack _waypointId};
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldUpdate", parseNumber ((count _missing) isEqualTo 0)],
                ["missing", _missing],
                ["attributes", keys (_params getOrDefault ["attributes", createHashMap])]
            ]
        };
        if ((count _missing) isEqualTo 0) then {
            collect3DENHistory {
                private _attributeResult = [_waypoint, _params getOrDefault ["attributes", createHashMap]] call AMCP_fnc_applyAttributes;
                _warnings append (_attributeResult getOrDefault ["warnings", []]);
            };
            _updated pushBack createHashMapFromArray [["edenId", _waypointId], ["op", "setWaypointAttributes"]];
        };
    };
    case "deleteWaypoint": {
        private _waypointId = _params getOrDefault ["waypointId", _params getOrDefault ["entityId", ""]];
        private _waypoint = [_waypointId] call _resolveWaypoint;
        if ((count _waypoint) isEqualTo 0) then {_missing pushBack _waypointId};
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldDelete", parseNumber ((count _missing) isEqualTo 0)],
                ["missing", _missing],
                ["warnings", _warnings]
            ]
        };
        if ((count _missing) isEqualTo 0) then {
            collect3DENHistory {
                delete3DENEntities [_waypoint];
            };
            _deleted pushBack _waypointId;
        };
    };
    case "reorderWaypoints": {
        private _groupId = _params getOrDefault ["groupId", ""];
        private _group = [_groupId] call _resolveGroup;
        private _orderedIds = _params getOrDefault ["orderedWaypointIds", []];
        if (isNull _group) then {_missing pushBack _groupId};
        private _records = [];
        {
            private _waypoint = [_x] call _resolveWaypoint;
            if ((count _waypoint) isEqualTo 0) then {
                _missing pushBack _x;
            } else {
                _records pushBack ([_waypoint] call _waypointRecord);
            };
        } forEach _orderedIds;

        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldReorder", count _records],
                ["missing", _missing],
                ["warnings", ["Waypoint reordering recreates waypoints to preserve order; Eden IDs will change after apply."]]
            ]
        };

        if ((count _missing) isEqualTo 0) then {
            collect3DENHistory {
                {
                    private _waypoint = [_x] call _resolveWaypoint;
                    if ((count _waypoint) > 0) then {delete3DENEntities [_waypoint]};
                } forEach _orderedIds;
                {
                    private _newWaypoint = _group create3DENEntity ["Waypoint", _x getOrDefault ["type", "MOVE"], _x getOrDefault ["positionATL", [0, 0, 0]]];
                    if (_newWaypoint isEqualType []) then {
                        [_newWaypoint, _x getOrDefault ["attributes", createHashMap]] call AMCP_fnc_applyAttributes;
                        _created pushBack createHashMapFromArray [
                            ["edenId", [_newWaypoint, "Waypoint"] call AMCP_fnc_registerEntity],
                            ["type", "Waypoint"],
                            ["groupId", [_group, "Group"] call AMCP_fnc_registerEntity],
                            ["previousEdenId", _x getOrDefault ["edenId", ""]]
                        ];
                    };
                } forEach _records;
            };
            _warnings pushBack "Waypoint reordering recreates waypoints to preserve order; Eden IDs changed.";
        };
    };
    case "attachWaypoint": {
        private _waypointId = _params getOrDefault ["waypointId", ""];
        private _groupId = _params getOrDefault ["groupId", ""];
        private _waypoint = [_waypointId] call _resolveWaypoint;
        private _group = [_groupId] call _resolveGroup;
        if ((count _waypoint) isEqualTo 0) then {_missing pushBack _waypointId};
        if (isNull _group) then {_missing pushBack _groupId};
        private _record = if ((count _waypoint) > 0) then {[_waypoint] call _waypointRecord} else {createHashMap};

        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["wouldAttach", parseNumber ((count _missing) isEqualTo 0)],
                ["missing", _missing],
                ["warnings", ["Waypoint group reassignment recreates the waypoint under the target group."]]
            ]
        };

        if ((count _missing) isEqualTo 0) then {
            collect3DENHistory {
                delete3DENEntities [_waypoint];
                private _newWaypoint = _group create3DENEntity ["Waypoint", _record getOrDefault ["type", "MOVE"], _record getOrDefault ["positionATL", [0, 0, 0]]];
                if (_newWaypoint isEqualType []) then {
                    [_newWaypoint, _record getOrDefault ["attributes", createHashMap]] call AMCP_fnc_applyAttributes;
                    _created pushBack createHashMapFromArray [
                        ["edenId", [_newWaypoint, "Waypoint"] call AMCP_fnc_registerEntity],
                        ["type", "Waypoint"],
                        ["groupId", [_group, "Group"] call AMCP_fnc_registerEntity],
                        ["previousEdenId", _waypointId]
                    ];
                    _deleted pushBack _waypointId;
                };
            };
            _warnings pushBack "Waypoint group reassignment recreated the waypoint under the target group.";
        };
    };
    case "getGroupLinks": {
        private _groupParams = +_params;
        _groupParams set ["dryRun", false];
        _returnDirect = true;
        _directResult = ["listGroupUnits", _groupParams] call AMCP_fnc_groupWaypointOps;
    };
    case "getWaypointLinks": {
        private _waypointId = _params getOrDefault ["waypointId", ""];
        private _waypoints = [];
        if (_waypointId isEqualTo "") then {
            _waypoints = (all3DENEntities param [3, []]);
        } else {
            private _waypoint = [_waypointId] call _resolveWaypoint;
            if ((count _waypoint) isEqualTo 0) then {_missing pushBack _waypointId} else {_waypoints = [_waypoint]};
        };
        private _links = [];
        {
            private _record = [_x] call _waypointRecord;
            _links pushBack createHashMapFromArray [
                ["waypointId", _record getOrDefault ["edenId", ""]],
                ["groupId", _record getOrDefault ["groupId", ""]],
                ["index", _record getOrDefault ["index", -1]],
                ["type", _record getOrDefault ["type", "MOVE"]],
                ["positionATL", _record getOrDefault ["positionATL", [0, 0, 0]]]
            ];
            _warnings append (_record getOrDefault ["warnings", []]);
        } forEach _waypoints;
        _returnDirect = true;
        _directResult = createHashMapFromArray [
            ["dryRun", false],
            ["waypoints", _links],
            ["missing", _missing],
            ["warnings", _warnings]
        ];
    };
    default {
        _warnings pushBack format ["Unsupported group/waypoint operation %1", _operation];
    };
};

if (_returnDirect) exitWith {_directResult};

createHashMapFromArray [
    ["dryRun", _dryRun],
    ["created", _created],
    ["updated", _updated],
    ["deleted", _deleted],
    ["missing", _missing],
    ["warnings", _warnings]
]
