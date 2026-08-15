import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import {
    DEFAULT_PROFILE_NAME,
    DEFAULT_USER_DATA_ROOT_NAME,
    resolveUserDataPaths,
    resolveWorkspaceStatePath,
} from "./userDataPaths.ts";

describe("resolveUserDataPaths", () => {
    const home = "/home/alice";

    it("uses ~/.diode by default", () => {
        const paths = resolveUserDataPaths({ homedir: home });
        expect(paths.root).toBe(`/home/alice/${DEFAULT_USER_DATA_ROOT_NAME}`);
        expect(paths.extensionsDir).toBe("/home/alice/.diode/extensions");
        expect(paths.userDir).toBe("/home/alice/.diode/user-data/User");
        expect(paths.settingsFile).toBe("/home/alice/.diode/user-data/User/settings.json");
        expect(paths.keybindingsFile).toBe("/home/alice/.diode/user-data/User/keybindings.json");
    });

    it("activates default profile when none specified", () => {
        const paths = resolveUserDataPaths({ homedir: home });
        expect(paths.profileName).toBe(DEFAULT_PROFILE_NAME);
        expect(paths.isDefaultProfile).toBe(true);
        expect(paths.profileDir).toBe(paths.userDir);
    });

    it("honors --user-data-dir override", () => {
        const paths = resolveUserDataPaths({ homedir: home, userDataDir: "/tmp/vexx" });
        expect(paths.root).toBe("/tmp/vexx");
        expect(paths.extensionsDir).toBe("/tmp/vexx/extensions");
        expect(paths.settingsFile).toBe("/tmp/vexx/user-data/User/settings.json");
    });

    it("resolves relative --user-data-dir to absolute", () => {
        const paths = resolveUserDataPaths({ homedir: home, userDataDir: "./local-vexx" });
        expect(paths.root.startsWith("/")).toBe(true);
        expect(paths.root.endsWith("/local-vexx")).toBe(true);
    });

    it("places named profile under User/profiles/<name>", () => {
        const paths = resolveUserDataPaths({ homedir: home, profile: "compact" });
        expect(paths.profileName).toBe("compact");
        expect(paths.isDefaultProfile).toBe(false);
        expect(paths.profileDir).toBe("/home/alice/.diode/user-data/User/profiles/compact");
        expect(paths.settingsFile).toBe("/home/alice/.diode/user-data/User/profiles/compact/settings.json");
    });

    it("treats explicit `default` profile as default", () => {
        const paths = resolveUserDataPaths({ homedir: home, profile: "default" });
        expect(paths.isDefaultProfile).toBe(true);
        expect(paths.profileDir).toBe(paths.userDir);
    });

    it("treats blank profile as default", () => {
        const paths = resolveUserDataPaths({ homedir: home, profile: "   " });
        expect(paths.isDefaultProfile).toBe(true);
    });

    it("rejects invalid profile name characters", () => {
        expect(() => resolveUserDataPaths({ homedir: home, profile: "with space" })).toThrow(/Invalid profile name/);
        expect(() => resolveUserDataPaths({ homedir: home, profile: "with/slash" })).toThrow();
        expect(() => resolveUserDataPaths({ homedir: home, profile: "../up" })).toThrow();
    });

    it("places machine-state paths under the default profile dir", () => {
        const paths = resolveUserDataPaths({ homedir: home });
        expect(paths.globalStateFile).toBe("/home/alice/.diode/user-data/User/globalState.json");
        expect(paths.workspaceStorageDir).toBe("/home/alice/.diode/user-data/User/workspaceStorage");
    });

    it("isolates machine-state paths per named profile", () => {
        const paths = resolveUserDataPaths({ homedir: home, profile: "compact" });
        expect(paths.globalStateFile).toBe("/home/alice/.diode/user-data/User/profiles/compact/globalState.json");
        expect(paths.workspaceStorageDir).toBe("/home/alice/.diode/user-data/User/profiles/compact/workspaceStorage");
    });
});

describe("resolveWorkspaceStatePath", () => {
    const storage = "/home/alice/.diode/user-data/User/workspaceStorage";

    it("keys state.json by sha256 of the resolved folder path", () => {
        const hash = crypto.createHash("sha256").update("/projects/app").digest("hex");
        expect(resolveWorkspaceStatePath(storage, "/projects/app")).toBe(`${storage}/${hash}/state.json`);
    });

    it("normalizes the folder path before hashing (trailing slash / . segments)", () => {
        const canonical = resolveWorkspaceStatePath(storage, "/projects/app");
        expect(resolveWorkspaceStatePath(storage, "/projects/app/")).toBe(canonical);
        expect(resolveWorkspaceStatePath(storage, "/projects/./app")).toBe(canonical);
        expect(resolveWorkspaceStatePath(storage, "/projects/sub/../app")).toBe(canonical);
    });

    it("produces different hashes for different folders", () => {
        expect(resolveWorkspaceStatePath(storage, "/a")).not.toBe(resolveWorkspaceStatePath(storage, "/b"));
    });
});
