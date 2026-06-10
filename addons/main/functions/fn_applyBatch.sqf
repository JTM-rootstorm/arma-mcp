params [
    ["_params", createHashMap]
];

private _dryRun = _params getOrDefault ["dryRun", true];
private _operations = _params getOrDefault ["operations", []];
private _validation = [_params] call AMCP_fnc_validateBatch;

if (!(_validation getOrDefault ["valid", false])) exitWith {
    createHashMapFromArray [
        ["dryRun", _dryRun],
        ["operationCount", count _operations],
        ["valid", false],
        ["errors", _validation getOrDefault ["errors", []]],
        ["warnings", _validation getOrDefault ["warnings", []]]
    ]
};

if (_dryRun) exitWith {
    createHashMapFromArray [
        ["dryRun", true],
        ["operationCount", count _operations],
        ["wouldCreate", (_validation get "stats") get "create"],
        ["wouldUpdate", (_validation get "stats") get "update"],
        ["wouldDelete", (_validation get "stats") get "delete"],
        ["warnings", _validation getOrDefault ["warnings", []]],
        ["errors", []]
    ]
};

private _created = [];
private _updated = [];
private _deleted = [];
private _selected = [];
private _warnings = _validation getOrDefault ["warnings", []];
private _isMissingEntity = {
    params ["_entity"];
    _entity isEqualTo objNull
};

collect3DENHistory {
    {
        private _op = _x getOrDefault ["op", ""];
        if (_op in ["create_entity", "create_marker", "create_trigger", "create_module"]) then {
                private _entityType = _x getOrDefault ["type", "Object"];
                if (_op isEqualTo "create_marker") then {_entityType = "Marker"};
                if (_op isEqualTo "create_trigger") then {_entityType = "Trigger"};
                if (_op isEqualTo "create_module") then {_entityType = "Module"};
                private _createParams = +_x;
                _createParams set ["dryRun", false];
                _createParams set ["type", _entityType];
                _createParams set ["select", false];
                private _createResult = [_createParams] call AMCP_fnc_createEntity;
                {
                    _x set ["clientRef", _createParams getOrDefault ["clientRef", ""]];
                    _created pushBack _x;
                } forEach (_createResult getOrDefault ["created", []]);
        } else {
            if (_op in ["create_group", "create_unit", "create_waypoint"]) then {
                private _relationshipParams = +_x;
                _relationshipParams set ["dryRun", false];
                private _relationshipOperation = switch (_op) do {
                    case "create_group": {"createGroup"};
                    case "create_unit": {"createUnit"};
                    default {"createWaypoint"};
                };
                private _relationshipResult = [_relationshipOperation, _relationshipParams] call AMCP_fnc_groupWaypointOps;
                {
                    _x set ["clientRef", _relationshipParams getOrDefault ["clientRef", ""]];
                    _created pushBack _x;
                } forEach (_relationshipResult getOrDefault ["created", []]);
                _warnings append (_relationshipResult getOrDefault ["warnings", []]);
        } else {
            if (_op isEqualTo "create_layer") then {
                private _layerParams = +_x;
                _layerParams set ["dryRun", false];
                private _layerResult = ["create", _layerParams] call AMCP_fnc_layerOps;
                _created append (_layerResult getOrDefault ["created", []]);
                _warnings append (_layerResult getOrDefault ["warnings", []]);
        } else {
            switch (_op) do {
            case "set_transform": {
                private _entityId = _x getOrDefault ["entityId", ""];
                private _entity = [_entityId] call AMCP_fnc_resolveEntity;
                if (!([_entity] call _isMissingEntity)) then {
                    private _previous = [_entity, _x getOrDefault ["transform", createHashMap]] call AMCP_fnc_applyTransform;
                    _updated pushBack createHashMapFromArray [
                        ["edenId", _entityId],
                        ["previous", _previous]
                    ];
                };
            };
            case "set_attributes": {
                private _entityId = _x getOrDefault ["entityId", ""];
                private _entity = [_entityId] call AMCP_fnc_resolveEntity;
                if (!([_entity] call _isMissingEntity)) then {
                    private _attributeResult = [_entity, _x getOrDefault ["attributes", createHashMap]] call AMCP_fnc_applyAttributes;
                    _updated pushBack createHashMapFromArray [
                        ["edenId", _entityId],
                        ["previous", _attributeResult getOrDefault ["previous", createHashMap]]
                    ];
                    _warnings append (_attributeResult getOrDefault ["warnings", []]);
                };
            };
            case "delete_entity": {
                private _ids = _x getOrDefault ["entityIds", []];
                if ((count _ids) isEqualTo 0 && {(_x getOrDefault ["entityId", ""]) isNotEqualTo ""}) then {
                    _ids = [_x get "entityId"];
                };
                private _entities = [];
                private _groups = [];
                {
                    private _entity = [_x] call AMCP_fnc_resolveEntity;
                    if (!([_entity] call _isMissingEntity)) then {
                        if (_entity isEqualType grpNull) then {
                            _entities append (units _entity);
                            _groups pushBack _entity;
                        } else {
                            _entities pushBack _entity;
                        };
                        _deleted pushBack _x;
                    };
                } forEach _ids;
                private _delete3DEN = +_entities;
                _delete3DEN append _groups;
                if (_delete3DEN isNotEqualTo []) then {
                    delete3DENEntities _delete3DEN;
                };
                {
                    if (!isNull _x) then {deleteGroup _x};
                } forEach _groups;
            };
            case "select_entities": {
                private _entities = [];
                {
                    private _entity = [_x] call AMCP_fnc_resolveEntity;
                    if (!([_entity] call _isMissingEntity)) then {
                        _entities pushBack _entity;
                        _selected pushBack _x;
                    };
                } forEach (_x getOrDefault ["entityIds", []]);
                set3DENSelected _entities;
            };
            case "assign_layer": {
                private _layerParams = +_x;
                _layerParams set ["dryRun", false];
                private _layerResult = ["assign", _layerParams] call AMCP_fnc_layerOps;
                {
                    _updated pushBack createHashMapFromArray [["edenId", _x], ["op", "assign_layer"]];
                } forEach (_layerResult getOrDefault ["updated", []]);
                _warnings append (_layerResult getOrDefault ["warnings", []]);
            };
            case "remove_from_layer": {
                private _layerParams = +_x;
                _layerParams set ["dryRun", false];
                private _layerResult = ["remove", _layerParams] call AMCP_fnc_layerOps;
                {
                    _updated pushBack createHashMapFromArray [["edenId", _x], ["op", "remove_from_layer"]];
                } forEach (_layerResult getOrDefault ["updated", []]);
                _warnings append (_layerResult getOrDefault ["warnings", []]);
            };
            case "sync_entities": {
                private _connectionParams = +_x;
                _connectionParams set ["dryRun", false];
                private _connectionResult = ["sync", _connectionParams] call AMCP_fnc_connectionOps;
                {
                    _updated pushBack createHashMapFromArray [["edenId", _x], ["op", "sync_entities"]];
                } forEach (_connectionResult getOrDefault ["updated", []]);
                _warnings append (_connectionResult getOrDefault ["warnings", []]);
            };
            case "unsync_entities": {
                private _connectionParams = +_x;
                _connectionParams set ["dryRun", false];
                private _connectionResult = ["unsync", _connectionParams] call AMCP_fnc_connectionOps;
                {
                    _updated pushBack createHashMapFromArray [["edenId", _x], ["op", "unsync_entities"]];
                } forEach (_connectionResult getOrDefault ["updated", []]);
                _warnings append (_connectionResult getOrDefault ["warnings", []]);
            };
            case "assign_unit_to_group": {
                private _relationshipParams = +_x;
                _relationshipParams set ["dryRun", false];
                private _relationshipResult = ["assignUnit", _relationshipParams] call AMCP_fnc_groupWaypointOps;
                _updated append (_relationshipResult getOrDefault ["updated", []]);
                _warnings append (_relationshipResult getOrDefault ["warnings", []]);
            };
            case "set_waypoint_attributes": {
                private _relationshipParams = +_x;
                _relationshipParams set ["dryRun", false];
                private _relationshipResult = ["setWaypointAttributes", _relationshipParams] call AMCP_fnc_groupWaypointOps;
                _updated append (_relationshipResult getOrDefault ["updated", []]);
                _warnings append (_relationshipResult getOrDefault ["warnings", []]);
            };
            case "reorder_waypoints": {
                private _relationshipParams = +_x;
                _relationshipParams set ["dryRun", false];
                private _relationshipResult = ["reorderWaypoints", _relationshipParams] call AMCP_fnc_groupWaypointOps;
                _created append (_relationshipResult getOrDefault ["created", []]);
                _updated append (_relationshipResult getOrDefault ["updated", []]);
                _warnings append (_relationshipResult getOrDefault ["warnings", []]);
            };
            case "delete_waypoint": {
                private _relationshipParams = +_x;
                _relationshipParams set ["dryRun", false];
                private _relationshipResult = ["deleteWaypoint", _relationshipParams] call AMCP_fnc_groupWaypointOps;
                _deleted append (_relationshipResult getOrDefault ["deleted", []]);
                _warnings append (_relationshipResult getOrDefault ["warnings", []]);
            };
            default {
                _warnings pushBack format ["Skipping unsupported batch operation %1", _op];
            };
            };
        };
        };
        };
    } forEach _operations;
};

createHashMapFromArray [
    ["dryRun", false],
    ["created", _created],
    ["updated", _updated],
    ["deleted", _deleted],
    ["selected", _selected],
    ["warnings", _warnings],
    ["errors", []]
]
