params [
    ["_params", createHashMap]
];

private _scanId = _params getOrDefault ["scanId", ""];
private _configPath = _params getOrDefault ["configPath", "CfgVehicles"];
private _chunkIndex = _params getOrDefault ["chunkIndex", 0];
private _chunkSize = _params getOrDefault ["chunkSize", 100];
private _includeRaw = _params getOrDefault ["includeRaw", false];

private _root = configFile >> _configPath;
private _records = [];

private _text = {
    params ["_cfg", "_name", ["_default", ""]];
    private _entry = _cfg >> _name;
    if (isText _entry) exitWith {getText _entry};
    _default
};

private _number = {
    params ["_cfg", "_name", ["_default", -1]];
    private _entry = _cfg >> _name;
    if (isNumber _entry) exitWith {getNumber _entry};
    _default
};

private _array = {
    params ["_cfg", "_name", ["_default", []]];
    private _entry = _cfg >> _name;
    if (isArray _entry) exitWith {getArray _entry};
    _default
};

private _sourceAddon = {
    params ["_cfg"];
    private _addons = configSourceAddonList _cfg;
    if (_addons isEqualType [] && {_addons isNotEqualTo []}) exitWith {_addons select 0};
    ""
};

private _sourceMod = {
    params ["_cfg"];
    private _mod = configSourceMod _cfg;
    if (_mod isEqualType "") exitWith {_mod};
    ""
};

private _parents = {
    params ["_cfg"];
    private _result = [];
    private _parent = inheritsFrom _cfg;
    while {isClass _parent} do {
        _result pushBack (configName _parent);
        _parent = inheritsFrom _parent;
    };
    _result
};

private _collectClasses = {
    params ["_cfg"];
    private _found = [];
    {
        _found pushBack _x;
        _found append ([_x] call _collectClasses);
    } forEach ("true" configClasses _cfg);
    _found
};

private _cache = missionNamespace getVariable ["AMCP_catalogScanCache", createHashMap];
private _cacheKey = format ["%1:%2", _scanId, _configPath];
private _cached = _cache getOrDefault [_cacheKey, []];
private _classes = _cached;
if !(_cached isEqualType []) then {
    _classes = [];
};
if (_classes isEqualTo [] && {isClass _root}) then {
    _classes = [_root] call _collectClasses;
    _cache set [_cacheKey, _classes];
    missionNamespace setVariable ["AMCP_catalogScanCache", _cache];
};

private _total = count _classes;
private _start = ((_params getOrDefault ["startIndex", _chunkIndex * _chunkSize]) max 0) min _total;
private _end = (_start + _chunkSize) min _total;

if (_start < _total) then {
    for "_index" from _start to (_end - 1) do {
        private _cfg = _classes select _index;
        private _record = createHashMapFromArray [
            ["class_name", configName _cfg],
            ["config_path", _configPath],
            ["display_name", [_cfg, "displayName", ""] call _text],
            ["scope", [_cfg, "scope", -1] call _number],
            ["scope_curator", [_cfg, "scopeCurator", -1] call _number],
            ["scope_arsenal", [_cfg, "scopeArsenal", -1] call _number],
            ["simulation", [_cfg, "simulation", ""] call _text],
            ["model_path", [_cfg, "model", ""] call _text],
            ["editor_category", [_cfg, "editorCategory", ""] call _text],
            ["editor_subcategory", [_cfg, "editorSubcategory", ""] call _text],
            ["vehicle_class", [_cfg, "vehicleClass", ""] call _text],
            ["faction", [_cfg, "faction", ""] call _text],
            ["side", [_cfg, "side", -1] call _number],
            ["author", [_cfg, "author", ""] call _text],
            ["dlc", [_cfg, "dlc", ""] call _text],
            ["source_addon", [_cfg] call _sourceAddon],
            ["source_mod", [_cfg] call _sourceMod],
            ["parents", [_cfg] call _parents]
        ];

        if (_includeRaw) then {
            private _rawConfig = createHashMapFromArray [
                ["scope", [_cfg, "scope", -1] call _number],
                ["scopeCurator", [_cfg, "scopeCurator", -1] call _number],
                ["scopeArsenal", [_cfg, "scopeArsenal", -1] call _number],
                ["requiredAddons", [_cfg, "requiredAddons", []] call _array],
                ["units", [_cfg, "units", []] call _array],
                ["weapons", [_cfg, "weapons", []] call _array],
                ["magazines", [_cfg, "magazines", []] call _array]
            ];
            _record set ["picture", [_cfg, "picture", ""] call _text];
            _record set ["icon", [_cfg, "icon", ""] call _text];
            _record set ["editor_preview", [_cfg, "editorPreview", ""] call _text];
            _record set ["weapons", [_cfg, "weapons", []] call _array];
            _record set ["magazines", [_cfg, "magazines", []] call _array];
            _record set ["linked_items", [_cfg, "linkedItems", []] call _array];
            _record set ["raw_config", _rawConfig];
        };

        _records pushBack _record;
    };
};

createHashMapFromArray [
    ["scan_id", _scanId],
    ["config_path", _configPath],
    ["chunk_index", _chunkIndex],
    ["start_index", _start],
    ["chunk_size", _chunkSize],
    ["total_records", _total],
    ["is_last_chunk", _end >= _total],
    ["records", _records]
]
