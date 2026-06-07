createHashMapFromArray [
    ["schemaVersion", 1],
    ["addon", "z_amcp_main"],
    ["actions", [
        "bridge.ping",
        "bridge.get_capabilities",
        "eden.get_status",
        "eden.get_selection",
        "eden.list_entities",
        "eden.find_entities",
        "eden.get_entity_snapshot",
        "eden.get_entities",
        "eden.get_entity_attributes",
        "assets.search_classes",
        "terrain.sample_area"
    ]],
    ["features", createHashMapFromArray [
        ["typedActions", true],
        ["entityRegistry", true],
        ["readSnapshots", true],
        ["writeBatch", false],
        ["rawSqf", false],
        ["historyGrouping", true]
    ]]
]
