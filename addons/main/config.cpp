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
            class buildObjectSnapshot {};
            class callBridge {};
            class captureSelection {};
            class log {};
            class pollCommands {};
            class postInit {
                postInit = 1;
            };
        };
    };
};
