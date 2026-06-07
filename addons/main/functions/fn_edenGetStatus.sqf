private _all = all3DENEntities;
private _selectedObjects = get3DENSelected "object";
private _selectedMarkers = get3DENSelected "marker";
private _selectedTriggers = get3DENSelected "trigger";

createHashMapFromArray [
    ["edenOpen", is3DEN],
    ["worldName", worldName],
    ["missionName", briefingName],
    ["selectedCounts", createHashMapFromArray [
        ["objects", count _selectedObjects],
        ["markers", count _selectedMarkers],
        ["triggers", count _selectedTriggers]
    ]],
    ["entityCounts", createHashMapFromArray [
        ["objects", count (_all param [0, []])],
        ["groups", count (_all param [1, []])],
        ["triggers", count (_all param [2, []])],
        ["waypoints", count (_all param [3, []])],
        ["logics", count (_all param [4, []])],
        ["markers", count (_all param [5, []])],
        ["layers", count (_all param [6, []])]
    ]]
]
