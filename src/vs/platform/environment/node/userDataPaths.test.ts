import * as crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { computeWorkspaceId } from "../../workspace/common/workspaceId.ts";

import {
    DEFAULT_PROFILE_NAME,
    DEFAULT_USER_DATA_ROOT_NAME,
    resolveUserDataPaths,
    resolveWorkspaceStatePath,
    resolveWorkspaceStorageDir,
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
        const paths = resolveUserDataPaths({ homedir: home, userDataDir: "/tmp/diode" });
        expect(paths.root).toBe("/tmp/diode");
        expect(paths.extensionsDir).toBe("/tmp/diode/extensions");
        expect(paths.settingsFile).toBe("/tmp/diode/user-data/User/settings.json");
    });

    it("honors --extensions-dir override without moving the rest of the layout", () => {
        const paths = resolveUserDataPaths({ homedir: home, extensionsDir: "/opt/diode-ext" });
        expect(paths.extensionsDir).toBe("/opt/diode-ext");
        expect(paths.root).toBe("/home/alice/.diode");
        expect(paths.settingsFile).toBe("/home/alice/.diode/user-data/User/settings.json");
    });

    it("resolves relative --extensions-dir to absolute, and ignores an empty one", () => {
        const relative = resolveUserDataPaths({ homedir: home, extensionsDir: "./ext" });
        expect(relative.extensionsDir.startsWith("/")).toBe(true);
        expect(relative.extensionsDir.endsWith("/ext")).toBe(true);
        expect(resolveUserDataPaths({ homedir: home, extensionsDir: "" }).extensionsDir).toBe(
            "/home/alice/.diode/extensions",
        );
    });

    it("combines --extensions-dir with --user-data-dir", () => {
        const paths = resolveUserDataPaths({ homedir: home, userDataDir: "/tmp/diode", extensionsDir: "/opt/ext" });
        expect(paths.extensionsDir).toBe("/opt/ext");
        expect(paths.root).toBe("/tmp/diode");
    });

    it("resolves relative --user-data-dir to absolute", () => {
        const paths = resolveUserDataPaths({ homedir: home, userDataDir: "./local-diode" });
        expect(paths.root.startsWith("/")).toBe(true);
        expect(paths.root.endsWith("/local-diode")).toBe(true);
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
        expect(() => resolveUserDataPaths({ homedir: home, profile: "with space" })).toThrow(/Invalid profile id/);
        expect(() => resolveUserDataPaths({ homedir: home, profile: "with/slash" })).toThrow();
        expect(() => resolveUserDataPaths({ homedir: home, profile: "../up" })).toThrow();
        expect(() => resolveUserDataPaths({ homedir: home, profile: ".." })).toThrow(/Invalid profile id/);
        expect(() => resolveUserDataPaths({ homedir: home, profile: "." })).toThrow(/Invalid profile id/);
    });

    it("keeps profilesHome and the application state file outside any profile", () => {
        const paths = resolveUserDataPaths({ homedir: home });
        const named = resolveUserDataPaths({ homedir: home, profile: "work" });
        expect(paths.profilesHome).toBe("/home/alice/.diode/user-data/User/profiles");
        expect(paths.applicationStateFile).toBe("/home/alice/.diode/user-data/User/globalStorage/storage.json");
        // A named profile moves neither the registry nor the directories' parent.
        expect(named.profilesHome).toBe(paths.profilesHome);
        expect(named.applicationStateFile).toBe(paths.applicationStateFile);
        expect(named.profileDir).toBe("/home/alice/.diode/user-data/User/profiles/work");
    });

    it("places machine-state paths under the default profile dir", () => {
        const paths = resolveUserDataPaths({ homedir: home });
        expect(paths.globalStateFile).toBe("/home/alice/.diode/user-data/User/globalState.json");
        expect(paths.secretsFile).toBe("/home/alice/.diode/user-data/User/secrets.json");
        expect(paths.workspaceStorageDir).toBe("/home/alice/.diode/user-data/User/workspaceStorage");
    });

    it("isolates machine-state paths per named profile", () => {
        const paths = resolveUserDataPaths({ homedir: home, profile: "compact" });
        expect(paths.globalStateFile).toBe("/home/alice/.diode/user-data/User/profiles/compact/globalState.json");
        // Secrets are per-profile too: work profile tokens are not visible from a personal one.
        expect(paths.secretsFile).toBe("/home/alice/.diode/user-data/User/profiles/compact/secrets.json");
        expect(paths.workspaceStorageDir).toBe("/home/alice/.diode/user-data/User/profiles/compact/workspaceStorage");
    });

    // globalStorage moves with the profile (like globalState), logs do not:
    // in vscode they sit next to `User/`, not inside the profile.
    it("places extension storage under the profile dir and logs outside it", () => {
        const paths = resolveUserDataPaths({ homedir: home });
        expect(paths.globalStorageDir).toBe("/home/alice/.diode/user-data/User/globalStorage");
        expect(paths.logsDir).toBe("/home/alice/.diode/user-data/logs");
    });

    it("isolates extension globalStorage per named profile, logs stay shared", () => {
        const paths = resolveUserDataPaths({ homedir: home, profile: "compact" });
        expect(paths.globalStorageDir).toBe("/home/alice/.diode/user-data/User/profiles/compact/globalStorage");
        expect(paths.logsDir).toBe("/home/alice/.diode/user-data/logs");
    });
});

describe("resolveWorkspaceStorageDir", () => {
    const storage = "/home/alice/.diode/user-data/User/workspaceStorage";
    // Workspace identity comes from OUTSIDE: the function does not derive it and does not know
    // what it was computed from (see computeWorkspaceId and its tests).
    const id = computeWorkspaceId("/projects/app");

    it("keys the dir by the workspace id verbatim", () => {
        expect(resolveWorkspaceStorageDir(storage, id)).toBe(`${storage}/${id}`);
    });

    // The extension directory (`<id>/<extId>` = storageUri) sits next to our
    // state.json, exactly like vscode's next to its state.vscdb.
    it("is the parent of state.json — extension dirs are its siblings", () => {
        expect(resolveWorkspaceStatePath(storage, id)).toBe(`${resolveWorkspaceStorageDir(storage, id)}/state.json`);
    });

    // The on-disk format stays what users already have:
    // workspaceStorage/<sha256(absolute folder path)>.
    it("lands on the same on-disk layout as before the id was introduced", () => {
        const hash = crypto.createHash("sha256").update("/projects/app").digest("hex");
        expect(resolveWorkspaceStorageDir(storage, id)).toBe(`${storage}/${hash}`);
    });
});

describe("resolveWorkspaceStatePath", () => {
    const storage = "/home/alice/.diode/user-data/User/workspaceStorage";

    it("puts state.json inside the workspace dir", () => {
        const id = computeWorkspaceId("/projects/app");
        expect(resolveWorkspaceStatePath(storage, id)).toBe(`${storage}/${id}/state.json`);
    });

    it("keeps different workspaces in different files", () => {
        expect(resolveWorkspaceStatePath(storage, computeWorkspaceId("/a"))).not.toBe(
            resolveWorkspaceStatePath(storage, computeWorkspaceId("/b")),
        );
    });
});
