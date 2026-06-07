class CfgPatches {
    class z_amcp_main {
        name = "Arma MCP";
        author = "Local";
        requiredVersion = 2.18;
        requiredAddons[] = {
            "A3_3DEN"
        };
        units[] = {};
        weapons[] = {};
    };
};

class CfgFunctions {
    class AMCP {
        class main {
            file = "\z\amcp\addons\main\functions";
            class applyPlan {};
            class applyAttributes {};
            class applyBatch {};
            class applyTransform {};
            class buildEntitySnapshot {};
            class buildObjectSnapshot {};
            class callBridge {};
            class applyComposition {};
            class captureComposition {};
            class captureSelection {};
            class createEntity {};
            class dispatchAction {};
            class edenGetStatus {};
            class edenListEntities {};
            class getCapabilities {};
            class log {};
            class pollCommands {};
            class postInit {
                postInit = 1;
            };
            class readEntityAttributes {};
            class registerEntity {};
            class resolveEntity {};
            class sampleTerrainArea {};
            class searchClasses {};
            class startEdenBridge {};
            class validateBatch {};
        };
    };
};

class Cfg3DEN {
    class EventHandlers {
        class AMCP {
            init = "[] spawn {waitUntil {sleep 0.1; is3DEN}; [] call AMCP_fnc_startEdenBridge;}";
            OnMissionLoad = "[] call AMCP_fnc_startEdenBridge";
            OnMissionNew = "[] call AMCP_fnc_startEdenBridge";
            OnMissionPreviewEnd = "[] spawn {sleep 0.5; [] call AMCP_fnc_startEdenBridge;}";
            OnTerrainNew = "[] call AMCP_fnc_startEdenBridge";
        };
    };
};
