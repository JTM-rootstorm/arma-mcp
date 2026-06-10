params [
    ["_operation", "list", [""]],
    ["_params", createHashMap]
];

private _dryRun = _params getOrDefault ["dryRun", true];

private _snapshotLayer = {
    params ["_layerId"];
    private _children = [];
    {
        private _childType = typeName _x;
        private _childId = "";
        if (_x isEqualType objNull || {_x isEqualType grpNull}) then {
            _childId = [_x, _childType] call AMCP_fnc_registerEntity;
        } else {
            _childId = str _x;
        };
        _children pushBack createHashMapFromArray [
            ["edenId", _childId],
            ["rawType", _childType]
        ];
    } forEach (get3DENLayerEntities _layerId);
    createHashMapFromArray [
        ["edenId", format ["eden:layer:%1", _layerId]],
        ["type", "Layer"],
        ["layerId", _layerId],
        ["children", _children],
        ["warnings", ["Layer display-name reads are limited by the public 3DEN scripting surface; layerId is stable for this Eden session."]]
    ]
};

private _findLayerId = {
    params ["_layer"];
    private _layerId = _layer getOrDefault ["layerId", -999999];
    if (_layerId isNotEqualTo -999999) exitWith {_layerId};
    private _name = _layer getOrDefault ["name", ""];
    if (_name isEqualTo "") exitWith {-999999};
    private _registry = missionNamespace getVariable ["AMCP_layerNameRegistry", createHashMap];
    _registry getOrDefault [_name, -999999]
};

private _ensureLayerId = {
    params ["_layer", "_warnings", ["_allowCreate", true]];
    private _layerId = [_layer] call _findLayerId;
    if (_allowCreate && {_layerId isEqualTo -999999} && {_layer getOrDefault ["createIfMissing", false]}) then {
        private _name = _layer getOrDefault ["name", ""];
        if (_name isNotEqualTo "") then {
            private _parentLayerId = _layer getOrDefault ["parentLayerId", -1];
            _layerId = _parentLayerId add3DENLayer _name;
            if (_layerId isEqualTo -1) then {
                _warnings pushBack format ["Failed to create layer %1 under parent %2", _name, _parentLayerId];
            } else {
                private _registry = missionNamespace getVariable ["AMCP_layerNameRegistry", createHashMap];
                _registry set [_name, _layerId];
                missionNamespace setVariable ["AMCP_layerNameRegistry", _registry];
            };
        };
    };
    _layerId
};

switch (_operation) do {
    case "list": {
        private _all = all3DENEntities;
        private _layers = [];
        {
            _layers pushBack ([_x] call _snapshotLayer);
        } forEach (_all param [6, []]);
        createHashMapFromArray [
            ["layers", _layers]
        ]
    };
    case "create": {
        private _name = _params getOrDefault ["name", ""];
        private _parentLayerId = _params getOrDefault ["parentLayerId", -1];
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["planned", [createHashMapFromArray [
                    ["op", "create_layer"],
                    ["name", _name],
                    ["parentLayerId", _parentLayerId]
                ]]]
            ]
        };
        private _layerId = _parentLayerId add3DENLayer _name;
        if (_layerId isNotEqualTo -1) then {
            private _registry = missionNamespace getVariable ["AMCP_layerNameRegistry", createHashMap];
            _registry set [_name, _layerId];
            missionNamespace setVariable ["AMCP_layerNameRegistry", _registry];
        };
        createHashMapFromArray [
            ["dryRun", false],
            ["created", [createHashMapFromArray [
                ["edenId", format ["eden:layer:%1", _layerId]],
                ["type", "Layer"],
                ["layerId", _layerId],
                ["name", _name]
            ]]],
            ["warnings", if (_layerId isEqualTo -1) then {[format ["Failed to create layer %1", _name]]} else {[]}]
        ]
    };
    case "assign": {
        private _warnings = [];
        private _layer = _params getOrDefault ["layer", createHashMap];
        if (_layer isEqualType "") then {
            _layer = createHashMapFromArray [["name", _layer], ["createIfMissing", true], ["parentLayerId", -1]];
        };
        private _entityIds = _params getOrDefault ["entityIds", []];
        private _layerId = [_layer, _warnings, !_dryRun] call _ensureLayerId;
        private _assigned = [];
        private _missing = [];
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["planned", [createHashMapFromArray [
                    ["op", "assign_layer"],
                    ["entityIds", _entityIds],
                    ["layerId", _layerId],
                    ["layer", _layer]
                ]]],
                ["warnings", _warnings]
            ]
        };
        if (_layerId isEqualTo -999999 || {_layerId isEqualTo -1}) then {
            _warnings pushBack "Layer could not be resolved for assignment.";
        } else {
            {
                private _entity = [_x] call AMCP_fnc_resolveEntity;
                if (_entity isEqualTo objNull) then {
                    _missing pushBack _x;
                } else {
                    if (_entity set3DENLayer _layerId) then {
                        _assigned pushBack _x;
                    } else {
                        _warnings pushBack format ["Failed to assign %1 to layer %2", _x, _layerId];
                    };
                };
            } forEach _entityIds;
        };
        createHashMapFromArray [
            ["dryRun", false],
            ["updated", _assigned],
            ["missing", _missing],
            ["layerId", _layerId],
            ["warnings", _warnings]
        ]
    };
    case "remove": {
        private _entityIds = _params getOrDefault ["entityIds", []];
        private _updated = [];
        private _missing = [];
        private _warnings = [];
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["planned", [createHashMapFromArray [
                    ["op", "remove_from_layer"],
                    ["entityIds", _entityIds],
                    ["layerId", -1]
                ]]]
            ]
        };
        {
            private _entity = [_x] call AMCP_fnc_resolveEntity;
            if (_entity isEqualTo objNull) then {
                _missing pushBack _x;
            } else {
                if (_entity set3DENLayer -1) then {
                    _updated pushBack _x;
                } else {
                    _warnings pushBack format ["Failed to move %1 to root layer", _x];
                };
            };
        } forEach _entityIds;
        createHashMapFromArray [
            ["dryRun", false],
            ["updated", _updated],
            ["missing", _missing],
            ["warnings", _warnings]
        ]
    };
    case "setAttributes": {
        private _warnings = ["Layer attribute writes are limited to the local layer name registry in this MVP slice."];
        private _layer = _params getOrDefault ["layer", createHashMap];
        private _layerId = [_layer] call _findLayerId;
        private _attributes = _params getOrDefault ["attributes", createHashMap];
        if (!_dryRun && {_attributes getOrDefault ["name", ""] isNotEqualTo ""} && {_layerId isNotEqualTo -999999}) then {
            private _registry = missionNamespace getVariable ["AMCP_layerNameRegistry", createHashMap];
            _registry set [_attributes get "name", _layerId];
            missionNamespace setVariable ["AMCP_layerNameRegistry", _registry];
        };
        createHashMapFromArray [
            ["dryRun", _dryRun],
            ["updated", if (_layerId isEqualTo -999999) then {[]} else {[format ["eden:layer:%1", _layerId]]}],
            ["layerId", _layerId],
            ["updatedAttributes", keys _attributes],
            ["warnings", _warnings]
        ]
    };
    case "delete": {
        private _warnings = [];
        private _layer = _params getOrDefault ["layer", createHashMap];
        private _layerId = [_layer] call _findLayerId;
        if (_dryRun) exitWith {
            createHashMapFromArray [
                ["dryRun", true],
                ["planned", [createHashMapFromArray [
                    ["op", "delete_layer"],
                    ["layerId", _layerId],
                    ["deleteEntities", _params getOrDefault ["deleteEntities", false]]
                ]]]
            ]
        };
        private _deleted = [];
        if (_layerId isEqualTo -999999) then {
            _warnings pushBack "Layer could not be resolved for deletion.";
        } else {
            if (_params getOrDefault ["deleteEntities", false]) then {
                delete3DENEntities (get3DENLayerEntities _layerId);
            };
            if (remove3DENLayer _layerId) then {
                _deleted pushBack format ["eden:layer:%1", _layerId];
            } else {
                _warnings pushBack format ["Failed to remove layer %1", _layerId];
            };
        };
        createHashMapFromArray [
            ["dryRun", false],
            ["deleted", _deleted],
            ["warnings", _warnings]
        ]
    };
    default {
        createHashMapFromArray [
            ["dryRun", _dryRun],
            ["errors", [createHashMapFromArray [
                ["code", "UNSUPPORTED_OPERATION"],
                ["message", format ["Unsupported layer operation %1", _operation]]
            ]]]
        ]
    };
}
