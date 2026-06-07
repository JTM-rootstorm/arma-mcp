params [
    ["_params", createHashMap]
];

private _className = _params getOrDefault ["className", ""];
private _vehicleConfig = configFile >> "CfgVehicles" >> _className;

if (_className isEqualTo "" || {!(isClass _vehicleConfig)}) exitWith {
    createHashMapFromArray [
        ["class_name", _className],
        ["status", "failed"],
        ["error", "class_not_found"]
    ]
};

private _obj = objNull;
private _result = createHashMap;

_obj = createVehicleLocal [_className, [0, 0, 0], [], 0, "CAN_COLLIDE"];
if (isNull _obj) exitWith {
    createHashMapFromArray [
        ["class_name", _className],
        ["status", "failed"],
        ["error", "createVehicleLocal_failed"]
    ]
};

private _bb = boundingBoxReal _obj;
private _min = _bb param [0, [0, 0, 0]];
private _max = _bb param [1, [0, 0, 0]];
private _center = boundingCenter _obj;
private _width = abs ((_max select 0) - (_min select 0));
private _depth = abs ((_max select 1) - (_min select 1));
private _height = abs ((_max select 2) - (_min select 2));
private _size = sizeOf _className;

deleteVehicle _obj;

_result = createHashMapFromArray [
    ["class_name", _className],
    ["status", "measured"],
    ["measurement", createHashMapFromArray [
        ["bbox_min", _min],
        ["bbox_max", _max],
        ["center", _center],
        ["width_m", _width],
        ["depth_m", _depth],
        ["height_m", _height],
        ["size_of", _size]
    ]]
];

_result
