import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveWorkspaceStorageDir } from "../../../../platform/environment/node/userDataPaths.ts";

import {
    ensureExtensionStorageParents,
    extensionStorageHomes,
    fallbackExtensionStorageHomes,
    type IExtensionStorageHomes,
    resolveExtensionStoragePaths,
} from "./extensionStoragePaths.ts";

describe("resolveExtensionStoragePaths", () => {
    const homes: IExtensionStorageHomes = {
        globalStorageHome: path.join(path.sep, "ud", "globalStorage"),
        workspaceStorageHome: path.join(path.sep, "ud", "workspaceStorage", "abc123"),
        logsHome: path.join(path.sep, "ud", "logs"),
    };

    it("puts the extension directory inside each root by its id", () => {
        const paths = resolveExtensionStoragePaths(homes, "supermaven.supermaven");
        expect(paths.globalStoragePath).toBe(path.join(homes.globalStorageHome, "supermaven.supermaven"));
        expect(paths.storagePath).toBe(
            path.join(path.sep, "ud", "workspaceStorage", "abc123", "supermaven.supermaven"),
        );
        expect(paths.logPath).toBe(path.join(homes.logsHome, "supermaven.supermaven"));
    });

    it("globalStorage uses the lowercase id, workspaceStorage and logs use the id as is", () => {
        const paths = resolveExtensionStoragePaths(homes, "Publisher.MixedCase");
        expect(paths.globalStoragePath).toBe(path.join(homes.globalStorageHome, "publisher.mixedcase"));
        expect(paths.storagePath).toBe(path.join(path.sep, "ud", "workspaceStorage", "abc123", "Publisher.MixedCase"));
        expect(paths.logPath).toBe(path.join(homes.logsHome, "Publisher.MixedCase"));
    });

    it("without a workspace root storagePath is null (no folder open)", () => {
        const paths = resolveExtensionStoragePaths({ ...homes, workspaceStorageHome: null }, "test.ext");
        expect(paths.storagePath).toBeNull();
        expect(paths.globalStoragePath).toBe(path.join(homes.globalStorageHome, "test.ext"));
        expect(paths.logPath).toBe(path.join(homes.logsHome, "test.ext"));
    });
});

describe("ensureExtensionStorageParents", () => {
    let tmp: string;

    beforeEach(() => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), "diode-extstorage-"));
    });

    afterEach(() => {
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("creates all three roots recursively", () => {
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(tmp, "user-data", "User", "globalStorage"),
            workspaceStorageHome: path.join(tmp, "user-data", "User", "workspaceStorage", "hash"),
            logsHome: path.join(tmp, "user-data", "logs"),
        };
        ensureExtensionStorageParents(homes);
        expect(fs.existsSync(homes.globalStorageHome)).toBe(true);
        expect(fs.existsSync(homes.workspaceStorageHome!)).toBe(true);
        expect(fs.existsSync(homes.logsHome)).toBe(true);
    });

    it("does NOT create the extension's own directory: by contract the extension creates it", () => {
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(tmp, "globalStorage"),
            workspaceStorageHome: null,
            logsHome: path.join(tmp, "logs"),
        };
        ensureExtensionStorageParents(homes);
        const { globalStoragePath } = resolveExtensionStoragePaths(homes, "test.ext");
        expect(fs.existsSync(path.dirname(globalStoragePath))).toBe(true);
        expect(fs.existsSync(globalStoragePath)).toBe(false);
    });

    it("skips a null root without failing", () => {
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(tmp, "g"),
            workspaceStorageHome: null,
            logsHome: path.join(tmp, "l"),
        };
        expect(() => {
            ensureExtensionStorageParents(homes);
        }).not.toThrow();
        expect(fs.readdirSync(tmp).sort()).toEqual(["g", "l"]);
    });

    it("passes a mkdir failure to onError and moves on", () => {
        const blocker = path.join(tmp, "blocker");
        fs.writeFileSync(blocker, "not a directory");
        const homes: IExtensionStorageHomes = {
            globalStorageHome: path.join(blocker, "globalStorage"),
            workspaceStorageHome: null,
            logsHome: path.join(tmp, "logs"),
        };
        const failures: string[] = [];
        ensureExtensionStorageParents(homes, (dir, err) => {
            failures.push(dir);
            expect(err).toBeInstanceOf(Error);
        });
        expect(failures).toEqual([homes.globalStorageHome]);
        expect(fs.existsSync(homes.logsHome)).toBe(true);
    });

    it("without onError a mkdir failure is swallowed", () => {
        const blocker = path.join(tmp, "file");
        fs.writeFileSync(blocker, "x");
        expect(() => {
            ensureExtensionStorageParents({
                globalStorageHome: path.join(blocker, "g"),
                workspaceStorageHome: null,
                logsHome: path.join(tmp, "l"),
            });
        }).not.toThrow();
    });
});

describe("fallbackExtensionStorageHomes", () => {
    it("roots are in the OS temp directory, no workspace root", () => {
        const homes = fallbackExtensionStorageHomes();
        const root = path.join(os.tmpdir(), "diode-extension-storage");
        expect(homes.globalStorageHome).toBe(path.join(root, "globalStorage"));
        expect(homes.logsHome).toBe(path.join(root, "logs"));
        expect(homes.workspaceStorageHome).toBeNull();
    });
});

describe("extensionStorageHomes", () => {
    const paths = {
        globalStorageDir: path.join(path.sep, "ud", "user-data", "User", "globalStorage"),
        workspaceStorageDir: path.join(path.sep, "ud", "user-data", "User", "workspaceStorage"),
        logsDir: path.join(path.sep, "ud", "user-data", "logs"),
    };

    it("with an open folder the workspace root is its directory in workspaceStorage", () => {
        const homes = extensionStorageHomes(paths, "/projects/app");
        expect(homes.workspaceStorageHome).toBe(resolveWorkspaceStorageDir(paths.workspaceStorageDir, "/projects/app"));
        expect(homes.globalStorageHome).toBe(paths.globalStorageDir);
        expect(homes.logsHome).toBe(paths.logsDir);
    });

    it("without an open folder there is no workspace root, the other two are in place", () => {
        const homes = extensionStorageHomes(paths, null);
        expect(homes.workspaceStorageHome).toBeNull();
        expect(homes.globalStorageHome).toBe(paths.globalStorageDir);
        expect(homes.logsHome).toBe(paths.logsDir);
    });

    it("different folders give different workspace roots", () => {
        expect(extensionStorageHomes(paths, "/a").workspaceStorageHome).not.toBe(
            extensionStorageHomes(paths, "/b").workspaceStorageHome,
        );
    });
});
