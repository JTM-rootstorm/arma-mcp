params [
    ["_params", createHashMap]
];

private _className = _params getOrDefault ["className", ""];
private _requestedRoot = _params getOrDefault ["configRoot", ""];
private _roots = if (_requestedRoot isEqualTo "") then {
    ["CfgVehicles", "CfgNonAIVehicles", "CfgMarkers", "CfgWaypoints", "CfgWeapons", "CfgMagazines", "CfgAmmo"]
} else {
    [_requestedRoot]
};

private _found = createHashMap;
{
    private _entry = configFile >> _x >> _className;
    if ((count _found) isEqualTo 0 && {isClass _entry}) then {
        _found = createHashMapFromArray [
            ["className", _className],
            ["configRoot", _x],
            ["displayName", getText (_entry >> "displayName")],
            ["scope", getNumber (_entry >> "scope")],
            ["scopeCurator", getNumber (_entry >> "scopeCurator")],
            ["faction", getText (_entry >> "faction")],
            ["editorCategory", getText (_entry >> "editorCategory")],
            ["editorSubcategory", getText (_entry >> "editorSubcategory")],
            ["vehicleClass", getText (_entry >> "vehicleClass")],
            ["model", getText (_entry >> "model")],
            ["side", getNumber (_entry >> "side")]
        ];
    };
} forEach _roots;

createHashMapFromArray [
    ["class", if ((count _found) > 0) then {_found} else {createHashMap}],
    ["found", (count _found) > 0],
    ["className", _className],
    ["searchedRoots", _roots]
]
