params [
    ["_params", createHashMap]
];

private _className = _params getOrDefault ["className", ""];
private _requestedRoot = _params getOrDefault ["configRoot", ""];
private _roots = if (_requestedRoot isEqualTo "") then {
    [
        "CfgVehicles",
        "CfgNonAIVehicles",
        "CfgMarkers",
        "CfgWaypoint",
        "CfgWaypoints",
        "CfgWeapons",
        "CfgMagazines",
        "CfgAmmo",
        "CfgGroups",
        "CfgFactionClasses",
        "CfgEditorCategories",
        "CfgEditorSubcategories",
        "Cfg3DEN"
    ]
} else {
    [_requestedRoot]
};

private _found = createHashMap;
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
private _childClassNames = {
    params ["_config"];
    private _names = [];
    if (isClass _config) then {
        for "_index" from 0 to ((count _config) - 1) do {
            private _child = _config select _index;
            if (isClass _child) then {
                _names pushBack (configName _child);
            };
        };
    };
    _names
};
{
    private _entry = configFile >> _x >> _className;
    if ((count _found) isEqualTo 0 && {isClass _entry}) then {
        private _displayName = getText (_entry >> "displayName");
        if (_displayName isEqualTo "") then {_displayName = getText (_entry >> "name")};
        _found = createHashMapFromArray [
            ["className", _className],
            ["configRoot", _x],
            ["displayName", _displayName],
            ["kind", [_x, _entry] call _kindForRoot],
            ["scope", getNumber (_entry >> "scope")],
            ["scopeCurator", getNumber (_entry >> "scopeCurator")],
            ["scopeArsenal", getNumber (_entry >> "scopeArsenal")],
            ["faction", getText (_entry >> "faction")],
            ["editorCategory", getText (_entry >> "editorCategory")],
            ["editorSubcategory", getText (_entry >> "editorSubcategory")],
            ["vehicleClass", getText (_entry >> "vehicleClass")],
            ["simulation", getText (_entry >> "simulation")],
            ["model", getText (_entry >> "model")],
            ["side", getNumber (_entry >> "side")],
            ["hiddenSelections", getArray (_entry >> "hiddenSelections")],
            ["hiddenSelectionsTextures", getArray (_entry >> "hiddenSelectionsTextures")],
            ["weapons", getArray (_entry >> "weapons")],
            ["magazines", getArray (_entry >> "magazines")],
            ["muzzles", getArray (_entry >> "muzzles")],
            ["ammo", getText (_entry >> "ammo")],
            ["picture", getText (_entry >> "picture")],
            ["icon", getText (_entry >> "icon")],
            ["parents", configHierarchy _entry apply {configName _x}],
            ["animationSources", [_entry >> "AnimationSources"] call _childClassNames],
            ["userActions", [_entry >> "UserActions"] call _childClassNames],
            ["warnings", [
                "Runtime dimensions require catalog.measureClass or a live object measurement.",
                "Screenshot, catalog tag, and visual tag details are available through catalog/visual tools, not direct config reads."
            ]]
        ];
    };
} forEach _roots;

createHashMapFromArray [
    ["class", if ((count _found) > 0) then {_found} else {createHashMap}],
    ["found", (count _found) > 0],
    ["className", _className],
    ["searchedRoots", _roots]
]
