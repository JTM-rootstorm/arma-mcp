params ["_object"];

private _className = typeOf _object;
private _displayName = getText (configFile >> "CfgVehicles" >> _className >> "displayName");
private _variableName = ((_object get3DENAttribute "Name") param [0, ""]);
private _modelInfo = getModelInfo _object;
private _model = _modelInfo param [1, ""];
private _bounds = boundingBoxReal _object;

createHashMapFromArray [
    ["edenId", netId _object],
    ["variableName", _variableName],
    ["className", _className],
    ["displayName", _displayName],
    ["model", _model],
    ["positionATL", getPosATL _object],
    ["direction", getDir _object],
    ["vectorDir", vectorDir _object],
    ["vectorUp", vectorUp _object],
    [
        "boundingBox",
        createHashMapFromArray [
            ["min", _bounds param [0, [0, 0, 0]]],
            ["max", _bounds param [1, [0, 0, 0]]]
        ]
    ],
    ["selections", selectionNames _object]
]
