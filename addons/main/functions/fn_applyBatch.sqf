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

collect3DENHistory {
    {
        private _op = _x getOrDefault ["op", ""];
        if (_op in ["create_entity", "create_marker", "create_trigger", "create_waypoint", "create_module"]) then {
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
            switch (_op) do {
            case "set_transform": {
                private _entityId = _x getOrDefault ["entityId", ""];
                private _entity = [_entityId] call AMCP_fnc_resolveEntity;
                if (!isNull _entity) then {
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
                if (!isNull _entity) then {
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
                {
                    private _entity = [_x] call AMCP_fnc_resolveEntity;
                    if (!isNull _entity) then {
                        _entities pushBack _entity;
                        _deleted pushBack _x;
                    };
                } forEach _ids;
                if (_entities isNotEqualTo []) then {
                    delete3DENEntities _entities;
                };
            };
            case "select_entities": {
                private _entities = [];
                {
                    private _entity = [_x] call AMCP_fnc_resolveEntity;
                    if (!isNull _entity) then {
                        _entities pushBack _entity;
                        _selected pushBack _x;
                    };
                } forEach (_x getOrDefault ["entityIds", []]);
                set3DENSelected _entities;
            };
            default {
                _warnings pushBack format ["Skipping unsupported batch operation %1", _op];
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
