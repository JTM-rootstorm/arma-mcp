params [
    ["_params", createHashMap]
];

private _center = _params getOrDefault ["centerATL", [0, 0, 0]];
private _radius = _params getOrDefault ["radiusMeters", 25];
private _spacing = _params getOrDefault ["spacingMeters", 10];
private _includeWater = _params getOrDefault ["includeWater", true];
private _includeSurfaceNormal = _params getOrDefault ["includeSurfaceNormal", false];
private _includeSurfaceType = _params getOrDefault ["includeSurfaceType", false];
private _includeRoads = _params getOrDefault ["includeRoads", false];
private _includeNearbyObjects = _params getOrDefault ["includeNearbyObjects", false];
private _nearbyObjectTypes = _params getOrDefault ["nearbyObjectTypes", ["HOUSE", "WALL", "ROCK", "TREE"]];
private _samples = [];
private _steps = ceil (_radius / _spacing);
private _minHeight = 1e9;
private _maxHeight = -1e9;
private _maxSlope = 0;
private _waterCount = 0;

for "_xStep" from -_steps to _steps do {
    for "_yStep" from -_steps to _steps do {
        private _dx = _xStep * _spacing;
        private _dy = _yStep * _spacing;
        if (((sqrt ((_dx * _dx) + (_dy * _dy))) <= _radius) && {(count _samples) < 500}) then {
            private _posATL = [
                (_center select 0) + _dx,
                (_center select 1) + _dy,
                _center select 2
            ];
            private _heightASL = getTerrainHeightASL _posATL;
            private _heightX = getTerrainHeightASL [(_posATL select 0) + _spacing, _posATL select 1, 0];
            private _heightY = getTerrainHeightASL [_posATL select 0, (_posATL select 1) + _spacing, 0];
            private _rise = sqrt (((_heightX - _heightASL) ^ 2) + ((_heightY - _heightASL) ^ 2));
            private _slopeDeg = atan (_rise / _spacing);
            private _sample = createHashMapFromArray [
                ["positionATL", _posATL],
                ["heightASL", _heightASL],
                ["slopeDeg", _slopeDeg]
            ];
            if (_includeWater) then {
                private _isWater = surfaceIsWater _posATL;
                _sample set ["isWater", _isWater];
                if (_isWater) then {_waterCount = _waterCount + 1};
            };
            if (_includeSurfaceNormal) then {
                _sample set ["surfaceNormal", surfaceNormal _posATL];
            };
            if (_includeSurfaceType) then {
                _sample set ["surfaceType", surfaceType _posATL];
            };
            if (_includeRoads) then {
                private _roads = _posATL nearRoads (_spacing max 5);
                _sample set ["roadCount", count _roads];
                if (_roads isNotEqualTo []) then {
                    _sample set ["nearestRoadDistanceM", _posATL distance2D (_roads select 0)];
                };
            };
            if (_includeNearbyObjects) then {
                _sample set ["nearbyObjectCount", count (nearestTerrainObjects [_posATL, _nearbyObjectTypes, (_spacing max 5), false, true])];
            };
            _minHeight = _minHeight min _heightASL;
            _maxHeight = _maxHeight max _heightASL;
            _maxSlope = _maxSlope max _slopeDeg;
            _samples pushBack _sample;
        };
    };
};

createHashMapFromArray [
    ["samples", _samples],
    ["summary", createHashMapFromArray [
        ["sampleCount", count _samples],
        ["minHeightASL", [_minHeight, 0] select (_samples isEqualTo [])],
        ["maxHeightASL", [_maxHeight, 0] select (_samples isEqualTo [])],
        ["heightVarianceM", if (_samples isEqualTo []) then {0} else {_maxHeight - _minHeight}],
        ["maxSlopeDeg", _maxSlope],
        ["waterCount", _waterCount],
        ["waterFraction", if (_samples isEqualTo []) then {0} else {_waterCount / (count _samples)}]
    ]],
    ["truncated", (count _samples) >= 500]
]
