params [
    ["_params", createHashMap]
];

private _query = toLower (_params getOrDefault ["query", ""]);
private _limit = _params getOrDefault ["limit", 25];
private _requestedKinds = _params getOrDefault ["kinds", []];
private _requestedFactions = _params getOrDefault ["factions", []];
private _requestedRoots = _params getOrDefault ["configRoots", []];
private _classes = [];
private _truncated = false;
private _roots = if (_requestedRoots isEqualTo []) then {
    [
        "CfgVehicles",
        "CfgNonAIVehicles",
        "CfgWeapons",
        "CfgMagazines",
        "CfgAmmo",
        "CfgGroups",
        "CfgMarkers",
        "CfgWaypoint",
        "CfgWaypoints",
        "CfgFactionClasses",
        "CfgEditorCategories",
        "CfgEditorSubcategories",
        "Cfg3DEN"
    ]
} else {
    _requestedRoots
};

private _kindForRoot = {
    params ["_root", "_entry"];
    switch (_root) do {
        case "CfgVehicles": {
            private _simulation = toLower getText (_entry >> "simulation");
            private _editorCategory = toLower getText (_entry >> "editorCategory");
            ["object", "module"] select ((_simulation isEqualTo "logic") || {(_editorCategory find "module") >= 0})
        };
        case "CfgNonAIVehicles": {"trigger"};
        case "CfgMarkers": {"marker"};
        case "CfgWaypoint": {"waypoint"};
        case "CfgWaypoints": {"waypoint"};
        case "CfgWeapons": {"weapon"};
        case "CfgMagazines": {"magazine"};
        case "CfgAmmo": {"ammo"};
        case "CfgGroups": {"group"};
        case "CfgFactionClasses": {"faction"};
        case "CfgEditorCategories": {"editorCategory"};
        case "CfgEditorSubcategories": {"editorSubcategory"};
        case "Cfg3DEN": {"edenConfig"};
        default {toLower _root};
    }
};

{
    if ((count _classes) >= _limit) exitWith {_truncated = true};
    private _root = _x;
    private _cfg = configFile >> _root;
    if (isClass _cfg) then {
        for "_index" from 0 to ((count _cfg) - 1) do {
            if ((count _classes) >= _limit) exitWith {_truncated = true};
            private _entry = _cfg select _index;
            if (isClass _entry) then {
                private _className = configName _entry;
                private _displayName = getText (_entry >> "displayName");
                if (_displayName isEqualTo "") then {_displayName = getText (_entry >> "name")};
                private _faction = getText (_entry >> "faction");
                private _kind = [_root, _entry] call _kindForRoot;
                private _haystack = toLower format [
                    "%1 %2 %3 %4 %5 %6 %7",
                    _className,
                    _displayName,
                    _kind,
                    _faction,
                    getText (_entry >> "editorCategory"),
                    getText (_entry >> "editorSubcategory"),
                    getText (_entry >> "vehicleClass")
                ];
                private _passesQuery = _query isEqualTo "" || {(_haystack find _query) >= 0};
                private _passesKind = _requestedKinds isEqualTo [] || {_kind in _requestedKinds || {_root in _requestedKinds}};
                private _passesFaction = _requestedFactions isEqualTo [] || {_faction in _requestedFactions};
                if (_passesQuery && {_passesKind} && {_passesFaction}) then {
                    _classes pushBack createHashMapFromArray [
                        ["className", _className],
                        ["configRoot", _root],
                        ["displayName", _displayName],
                        ["kind", _kind],
                        ["faction", _faction],
                        ["editorCategory", getText (_entry >> "editorCategory")],
                        ["editorSubcategory", getText (_entry >> "editorSubcategory")],
                        ["vehicleClass", getText (_entry >> "vehicleClass")],
                        ["scope", getNumber (_entry >> "scope")]
                    ];
                };
            };
        };
    };
} forEach _roots;

createHashMapFromArray [
    ["classes", _classes],
    ["searchedRoots", _roots],
    ["truncated", _truncated]
]
