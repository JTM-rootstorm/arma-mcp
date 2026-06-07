params [
    ["_params", createHashMap]
];

private _center = _params getOrDefault ["centerATL", [0, 0, 0]];
private _radius = _params getOrDefault ["radiusMeters", 25];
private _spacing = _params getOrDefault ["spacingMeters", 10];
private _includeWater = _params getOrDefault ["includeWater", true];
private _samples = [];
private _steps = ceil (_radius / _spacing);

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
                _sample set ["isWater", surfaceIsWater _posATL];
            };
            _samples pushBack _sample;
        };
    };
};

createHashMapFromArray [
    ["samples", _samples],
    ["truncated", (count _samples) >= 500]
]
