import * as os from "node:os";

import { describe, expect, it } from "vitest";

import { createEnvironmentService } from "./environmentService.ts";
import { resolveUserDataPaths } from "./userDataPaths.ts";

describe("createEnvironmentService", () => {
    it("takes app and active profile paths from the resolved user data", () => {
        const paths = resolveUserDataPaths({ homedir: "/home/alice", profile: "work", extensionsDir: "/opt/ext" });

        const env = createEnvironmentService(paths, { registry: undefined }, "/home/alice");

        expect(env).toEqual({
            userDataRoot: "/home/alice/.diode",
            extensionsDir: "/opt/ext",
            logsDir: "/home/alice/.diode/user-data/logs",
            registry: undefined,
            userHome: "/home/alice",
            settingsResource: "/home/alice/.diode/user-data/User/profiles/work/settings.json",
            keybindingsResource: "/home/alice/.diode/user-data/User/profiles/work/keybindings.json",
            globalStorageDir: "/home/alice/.diode/user-data/User/profiles/work/globalStorage",
            workspaceStorageDir: "/home/alice/.diode/user-data/User/profiles/work/workspaceStorage",
            secretsFile: "/home/alice/.diode/user-data/User/profiles/work/secrets.json",
        });
    });

    it("home directory defaults to the process home directory", () => {
        const paths = resolveUserDataPaths({ homedir: "/home/alice" });
        expect(createEnvironmentService(paths, { registry: undefined }).userHome).toBe(os.homedir());
    });

    it("passes --registry through", () => {
        const paths = resolveUserDataPaths({ homedir: "/home/alice" });

        expect(createEnvironmentService(paths, { registry: "https://example.test/registry" }).registry).toBe(
            "https://example.test/registry",
        );
    });
});
