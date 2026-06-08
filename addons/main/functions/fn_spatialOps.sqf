params [
    ["_operation", "", [""]],
    ["_params", createHashMap]
];

private _terrainSummary = {
    params ["_center", "_radius", "_spacing"];
    private _sample = [createHashMapFromArray [
        ["centerATL", _center],
        ["radiusMeters", _radius],
        ["spacingMeters", _spacing],
        ["includeWater", true],
        ["includeSurfaceNormal", true],
        ["includeSurfaceType", true],
        ["includeRoads", false],
        ["includeNearbyObjects", false]
    ]] call AMCP_fnc_sampleTerrainArea;
    _sample getOrDefault ["summary", createHashMap]
};

private _roadRows = {
    params ["_position", "_radius", "_limit", "_extended"];
    private _roads = _position nearRoads _radius;
    private _rows = [];
    {
        if ((count _rows) < _limit) then {
            private _roadPos = getPosATL _x;
            private _connections = roadsConnectedTo [_x, _extended];
            private _dir = 0;
            if (_connections isNotEqualTo []) then {
                private _connectedPos = getPosATL (_connections select 0);
                _dir = _roadPos getDir _connectedPos;
            };
            _rows pushBack createHashMapFromArray [
                ["positionATL", _roadPos],
                ["distanceM", _position distance2D _roadPos],
                ["dir", _dir],
                ["connectionCount", count _connections],
                ["isOnRoad", isOnRoad _roadPos]
            ];
        };
    } forEach _roads;
    _rows
};

private _operationPosition = {
    params ["_op"];
    private _transform = _op getOrDefault ["transform", createHashMap];
    _transform getOrDefault ["positionATL", [0, 0, 0]]
};

private _collisionRows = {
    params ["_operations", "_position", "_radius", "_types", "_includeTerrainObjects"];
    private _warnings = [];
    private _collisions = [];
    private _items = [];
    {
        private _pos = [_x] call _operationPosition;
        private _itemRadius = _x getOrDefault ["radiusMeters", 2.5];
        _items pushBack [_x getOrDefault ["clientRef", format ["operation_%1", _forEachIndex + 1]], _pos, _itemRadius];
    } forEach _operations;
    if (_position isNotEqualTo []) then {
        _items pushBack ["probe", _position, _radius];
    };
    for "_i" from 0 to ((count _items) - 1) do {
        private _a = _items select _i;
        for "_j" from (_i + 1) to ((count _items) - 1) do {
            private _b = _items select _j;
            private _distance = (_a select 1) distance2D (_b select 1);
            private _threshold = (_a select 2) + (_b select 2);
            if (_distance < _threshold) then {
                _collisions pushBack createHashMapFromArray [
                    ["kind", "planned_overlap"],
                    ["a", _a select 0],
                    ["b", _b select 0],
                    ["distanceM", _distance],
                    ["thresholdM", _threshold]
                ];
            };
        };
    };
    if (_includeTerrainObjects) then {
        {
            private _near = nearestTerrainObjects [_x select 1, _types, _x select 2, true, true];
            if (_near isNotEqualTo []) then {
                _collisions pushBack createHashMapFromArray [
                    ["kind", "terrain_object_nearby"],
                    ["entity", _x select 0],
                    ["count", count _near],
                    ["nearestDistanceM", (_x select 1) distance2D (getPosATL (_near select 0))]
                ];
            };
        } forEach _items;
    };
    createHashMapFromArray [
        ["collisions", _collisions],
        ["warnings", _warnings],
        ["blocking", _collisions select {(_x getOrDefault ["kind", ""]) isEqualTo "planned_overlap"}]
    ]
};

private _scorePlacement = {
    params ["_position", "_radius", "_spacing", "_intendedUse", "_maxSlope", "_avoidWater", "_requireRoad"];
    private _summary = [_position, _radius, _spacing] call _terrainSummary;
    private _warnings = [];
    private _errors = [];
    private _score = 100;
    private _waterFraction = _summary getOrDefault ["waterFraction", 0];
    private _slope = _summary getOrDefault ["maxSlopeDeg", 0];
    private _variance = _summary getOrDefault ["heightVarianceM", 0];
    if (_avoidWater && {_waterFraction > 0}) then {
        _score = _score - (50 * _waterFraction);
        _errors pushBack createHashMapFromArray [["code", "WATER_IN_AREA"], ["message", "Placement area includes water."]];
    };
    if (_slope > _maxSlope) then {
        _score = _score - ((_slope - _maxSlope) * 4);
        _errors pushBack createHashMapFromArray [["code", "SLOPE_TOO_STEEP"], ["message", format ["Max slope %1 exceeds threshold %2", _slope, _maxSlope]]];
    };
    if (_variance > (_radius * 0.2)) then {
        _score = _score - 15;
        _warnings pushBack format ["Height variance %1m may make placement uneven.", _variance];
    };
    private _roads = [_position, _radius max 25, 3, true] call _roadRows;
    if (_requireRoad && {_roads isEqualTo []}) then {
        _score = _score - 30;
        _errors pushBack createHashMapFromArray [["code", "ROAD_NOT_FOUND"], ["message", "No nearby road found for road-aligned placement."]];
    };
    if (_intendedUse isEqualTo "lz" && {_slope > 6}) then {
        _score = _score - 20;
        _warnings pushBack "Landing zones should prefer very low slope.";
    };
    if (_intendedUse isEqualTo "road_checkpoint" && {_roads isNotEqualTo []}) then {
        _warnings pushBack format ["Nearest road direction estimate: %1 degrees.", (_roads select 0) getOrDefault ["dir", 0]];
    };
    createHashMapFromArray [
        ["score", 0 max (100 min _score)],
        ["summary", _summary],
        ["roads", _roads],
        ["warnings", _warnings],
        ["errors", _errors],
        ["blocking", _errors]
    ]
};

private _losRows = {
    params ["_checks"];
    private _rows = [];
    {
        private _fromASL = _x getOrDefault ["fromASL", []];
        private _toASL = _x getOrDefault ["toASL", []];
        if (_fromASL isEqualTo [] && {(_x getOrDefault ["fromATL", []]) isNotEqualTo []}) then {
            _fromASL = ATLToASL (_x get "fromATL");
        };
        if (_toASL isEqualTo [] && {(_x getOrDefault ["toATL", []]) isNotEqualTo []}) then {
            _toASL = ATLToASL (_x get "toATL");
        };
        private _hits = if (_fromASL isEqualTo [] || {_toASL isEqualTo []}) then {[]} else {
            lineIntersectsSurfaces [_fromASL, _toASL, objNull, objNull, true, 1, "VIEW", "FIRE"]
        };
        private _first = if (_hits isEqualTo []) then {[]} else {_hits select 0};
        _rows pushBack createHashMapFromArray [
            ["clear", _hits isEqualTo []],
            ["hitCount", count _hits],
            ["firstHit", if (_first isEqualTo []) then {createHashMap} else {createHashMapFromArray [
                ["positionASL", _first param [0, []]],
                ["surfaceNormal", _first param [1, []]],
                ["object", str (_first param [2, objNull])]
            ]}]
        ];
    } forEach _checks;
    _rows
};

switch (_operation) do {
    case "findFlatArea": {
        private _center = _params getOrDefault ["centerATL", [0, 0, 0]];
        private _searchRadius = _params getOrDefault ["searchRadiusMeters", 250];
        private _sampleRadius = _params getOrDefault ["sampleRadiusMeters", 25];
        private _spacing = _params getOrDefault ["spacingMeters", 10];
        private _maxSlope = _params getOrDefault ["maxSlopeDeg", 8];
        private _allowWater = _params getOrDefault ["allowWater", false];
        private _limit = _params getOrDefault ["limit", 10];
        private _candidates = [];
        private _steps = ceil (_searchRadius / (_sampleRadius max _spacing));
        for "_xStep" from -_steps to _steps do {
            for "_yStep" from -_steps to _steps do {
                if ((count _candidates) < _limit) then {
                    private _pos = [(_center select 0) + (_xStep * _sampleRadius), (_center select 1) + (_yStep * _sampleRadius), _center select 2];
                    if ((_pos distance2D _center) <= _searchRadius) then {
                        private _summary = [_pos, _sampleRadius, _spacing] call _terrainSummary;
                        private _waterOk = _allowWater || {(_summary getOrDefault ["waterFraction", 0]) isEqualTo 0};
                        if (_waterOk && {(_summary getOrDefault ["maxSlopeDeg", 999]) <= _maxSlope}) then {
                            _candidates pushBack createHashMapFromArray [
                                ["positionATL", _pos],
                                ["distanceM", _pos distance2D _center],
                                ["summary", _summary],
                                ["score", 100 - ((_summary getOrDefault ["maxSlopeDeg", 0]) * 3) - ((_summary getOrDefault ["heightVarianceM", 0]) * 2)]
                            ];
                        };
                    };
                };
            };
        };
        createHashMapFromArray [["candidates", _candidates], ["truncated", (count _candidates) >= _limit]]
    };
    case "findNearestRoads": {
        private _position = _params getOrDefault ["positionATL", [0, 0, 0]];
        createHashMapFromArray [
            ["roads", [_position, _params getOrDefault ["radiusMeters", 100], _params getOrDefault ["limit", 10], _params getOrDefault ["extendedConnections", true]] call _roadRows]
        ]
    };
    case "checkCollision": {
        [_params getOrDefault ["operations", []], _params getOrDefault ["positionATL", []], _params getOrDefault ["radiusMeters", 5], _params getOrDefault ["terrainObjectTypes", ["HOUSE", "WALL", "ROCK", "TREE", "ROAD"]], _params getOrDefault ["includeTerrainObjects", true]] call _collisionRows
    };
    case "scorePlacement": {
        [_params getOrDefault ["positionATL", [0, 0, 0]], _params getOrDefault ["radiusMeters", 25], _params getOrDefault ["spacingMeters", 10], _params getOrDefault ["intendedUse", "generic"], _params getOrDefault ["maxSlopeDeg", 10], _params getOrDefault ["avoidWater", true], _params getOrDefault ["requireRoad", false]] call _scorePlacement
    };
    case "lineOfSight": {
        private _checks = _params getOrDefault ["samples", []];
        if (_checks isEqualTo []) then {_checks = [_params]};
        createHashMapFromArray [["results", [_checks] call _losRows]]
    };
    case "findCoverPositions": {
        private _center = _params getOrDefault ["centerATL", [0, 0, 0]];
        private _objects = nearestTerrainObjects [_center, _params getOrDefault ["objectTypes", ["WALL", "ROCK", "TREE", "HOUSE", "FENCE"]], _params getOrDefault ["radiusMeters", 50], true, true];
        private _limit = _params getOrDefault ["limit", 10];
        private _candidates = [];
        {
            if ((count _candidates) < _limit) then {
                private _pos = getPosATL _x;
                _candidates pushBack createHashMapFromArray [
                    ["positionATL", _pos],
                    ["distanceM", _center distance2D _pos],
                    ["object", str _x],
                    ["score", 80 max (100 - (_center distance2D _pos))]
                ];
            };
        } forEach _objects;
        createHashMapFromArray [["candidates", _candidates]]
    };
    case "findLzCandidates": {
        private _flatParams = createHashMapFromArray [
            ["centerATL", _params getOrDefault ["centerATL", [0, 0, 0]]],
            ["searchRadiusMeters", _params getOrDefault ["searchRadiusMeters", 300]],
            ["sampleRadiusMeters", _params getOrDefault ["lzRadiusMeters", 30]],
            ["spacingMeters", _params getOrDefault ["spacingMeters", 25]],
            ["maxSlopeDeg", _params getOrDefault ["maxSlopeDeg", 6]],
            ["allowWater", false],
            ["limit", _params getOrDefault ["limit", 10]]
        ];
        private _flat = ["findFlatArea", _flatParams] call AMCP_fnc_spatialOps;
        private _candidates = [];
        {
            private _score = [_x get "positionATL", _params getOrDefault ["lzRadiusMeters", 30], _params getOrDefault ["spacingMeters", 25], "lz", _params getOrDefault ["maxSlopeDeg", 6], true, false] call _scorePlacement;
            _candidates pushBack createHashMapFromArray [
                ["positionATL", _x get "positionATL"],
                ["flatness", _x],
                ["score", _score getOrDefault ["score", 0]],
                ["warnings", _score getOrDefault ["warnings", []]],
                ["errors", _score getOrDefault ["errors", []]]
            ];
        } forEach (_flat getOrDefault ["candidates", []]);
        createHashMapFromArray [["candidates", _candidates]]
    };
    default {
        createHashMapFromArray [
            ["errors", [createHashMapFromArray [
                ["code", "UNSUPPORTED_ACTION"],
                ["message", format ["Unsupported spatial operation %1", _operation]]
            ]]]
        ]
    };
}
