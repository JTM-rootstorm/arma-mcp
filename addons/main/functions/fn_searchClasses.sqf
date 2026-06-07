params [
    ["_params", createHashMap]
];

private _query = toLower (_params getOrDefault ["query", ""]);
private _limit = _params getOrDefault ["limit", 25];
private _classes = [];
private _cfgVehicles = configFile >> "CfgVehicles";

for "_index" from 0 to ((count _cfgVehicles) - 1) do {
    if ((count _classes) >= _limit) exitWith {};
    private _entry = _cfgVehicles select _index;
    if (isClass _entry) then {
        private _className = configName _entry;
        private _displayName = getText (_entry >> "displayName");
        private _haystack = toLower format ["%1 %2", _className, _displayName];
        if (_query isEqualTo "" || {(_haystack find _query) >= 0}) then {
            _classes pushBack createHashMapFromArray [
                ["className", _className],
                ["displayName", _displayName],
                ["kind", "object"],
                ["faction", getText (_entry >> "faction")],
                ["editorCategory", getText (_entry >> "editorCategory")],
                ["editorSubcategory", getText (_entry >> "editorSubcategory")]
            ];
        };
    };
};

createHashMapFromArray [
    ["classes", _classes],
    ["truncated", (count _classes) >= _limit]
]
