import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    extensionFixture,
    subprocessSpawnArgsForTests,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import type { ICommandService } from "../../../api/common/iCommandService.ts";
import type { IEditorOptionsService } from "../../../api/common/iEditorOptionsService.ts";

import { ExtensionHost } from "./extensionHost.ts";
import type { IExtensionStorageHomes } from "./extensionStoragePaths.ts";

const NOOP_EDITOR_OPTIONS = {
    getActiveEditorOptions: () => null,
    setActiveEditorOptions: () => undefined,
    getActiveEditorFilePath: () => null,
    getActiveEditorMeta: () => ({ uri: null, languageId: null, isDirty: false }),
    onActiveEditorChanged: () => ({ dispose: () => undefined }),
    onActiveEditorSelectionChanged: () => ({ dispose: () => undefined }),
    setActiveEditorSelections: () => undefined,
    applyActiveEditorEdits: () => true,
} as unknown as IEditorOptionsService;

const NOOP_COMMANDS = {
    execute: () => undefined,
    registerProxy: () => ({ dispose: () => undefined }),
} as unknown as ICommandService;

interface IStorageReport {
    globalStorageFsPath: string;
    globalStorageScheme: string;
    globalStoragePath: string;
    storageFsPath: string | null;
    storagePath: string | null;
    logFsPath: string;
    logPath: string;
    logParentExists: boolean;
    logDirExists: boolean;
}

function storageFixture(id = "test.storage"): ReturnType<typeof extensionFixture> {
    return extensionFixture(id, "reportsStorage.cjs");
}

describe("ExtensionHost — extension storage directories", () => {
    const roots: string[] = [];
    const makeRoot = (): string => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-extstorage-host-"));
        roots.push(root);
        return root;
    };

    afterEach(() => {
        for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    });

    it("globalStorageUri / storageUri / logUri come from the host and point inside its roots", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture()] });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.globalStorageFsPath).toBe(path.join(harness.tmpDir, "globalStorage", "test.storage"));
            expect(report.storageFsPath).toBe(path.join(harness.tmpDir, "workspaceStorage", "test.storage"));
            expect(report.logFsPath).toBe(path.join(harness.tmpDir, "logs", "test.storage"));
            expect(report.globalStorageScheme).toBe("file");
            expect(report.globalStoragePath).toBe(report.globalStorageFsPath);
            expect(report.storagePath).toBe(report.storageFsPath);
            expect(report.logPath).toBe(report.logFsPath);
        } finally {
            await harness.dispose();
        }
    });

    // Not that the field exists, but that it can be written to: the host created the parent.
    it("the extension creates its directory and writes to it: the parent exists before activate()", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture()] });
        try {
            const engine = path.join(harness.tmpDir, "globalStorage", "test.storage", "sm-agent");
            expect(fs.readFileSync(engine, "utf-8")).toBe("downloaded engine");
        } finally {
            await harness.dispose();
        }
    });

    // vscode.d.ts: «the directory might not exist … the parent directory is
    // guaranteed to be existent».
    it("the host creates only the PARENT and leaves the extension directory to the extension", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture()] });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.logParentExists).toBe(true);
            expect(report.logDirExists).toBe(false);
        } finally {
            await harness.dispose();
        }
    });

    it("without an open folder storageUri/storagePath are undefined (vscode semantics)", async () => {
        const root = makeRoot();
        const harness = await createExtensionTestHarness({
            extensions: [storageFixture()],
            storageHomes: (): IExtensionStorageHomes => ({
                globalStorageHome: path.join(root, "globalStorage"),
                workspaceStorageHome: null,
                logsHome: path.join(root, "logs"),
            }),
        });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.storageFsPath).toBeNull();
            expect(report.storagePath).toBeNull();
            expect(report.globalStorageFsPath).toBe(path.join(root, "globalStorage", "test.storage"));
        } finally {
            await harness.dispose();
        }
    });

    it("globalStorage is keyed by lowercase id, as upstream", async () => {
        const harness = await createExtensionTestHarness({ extensions: [storageFixture("Publisher.MixedCase")] });
        try {
            const report = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(report.globalStorageFsPath).toBe(path.join(harness.tmpDir, "globalStorage", "publisher.mixedcase"));
            // The workspace and log directories use the id as is.
            expect(report.storageFsPath).toBe(path.join(harness.tmpDir, "workspaceStorage", "Publisher.MixedCase"));
            expect(report.logFsPath).toBe(path.join(harness.tmpDir, "logs", "Publisher.MixedCase"));
        } finally {
            await harness.dispose();
        }
    });

    it("when it fails to create a root, the host logs a warning and activates the extension", async () => {
        const root = makeRoot();
        // A file in place of the directory: mkdir of a path inside it is doomed.
        const blocker = path.join(root, "not-a-dir");
        fs.writeFileSync(blocker, "not a directory");
        const warnings: { message: string; detail: unknown }[] = [];
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
            spawnArgs: subprocessSpawnArgsForTests(),
            storageHomes: (): IExtensionStorageHomes => ({
                globalStorageHome: path.join(blocker, "globalStorage"),
                workspaceStorageHome: null,
                logsHome: path.join(root, "logs"),
            }),
            logger: {
                trace: () => undefined,
                debug: () => undefined,
                info: () => undefined,
                warn: (message: string, detail?: unknown) => warnings.push({ message, detail }),
                error: () => undefined,
                isEnabled: () => true,
            } as unknown as ILogger,
        });
        try {
            host.registerExtension(storageFixture("test.unwritable"));
            await host.activateByEvent("*");

            expect(warnings).toHaveLength(1);
            expect(warnings[0].message).toContain(path.join(blocker, "globalStorage"));
            expect(warnings[0].detail).toBeInstanceOf(Error);
            // The sibling root is still created: one failure does not cancel the others.
            expect(fs.existsSync(path.join(root, "logs"))).toBe(true);
        } finally {
            host.dispose();
        }
    });

    it("a host without a logger survives an inaccessible root", async () => {
        const root = makeRoot();
        const blocker = path.join(root, "not-a-dir");
        fs.writeFileSync(blocker, "not a directory");
        const host = new ExtensionHost(NOOP_EDITOR_OPTIONS, NOOP_COMMANDS, {
            spawnArgs: subprocessSpawnArgsForTests(),
            storageHomes: (): IExtensionStorageHomes => ({
                globalStorageHome: path.join(blocker, "globalStorage"),
                workspaceStorageHome: null,
                logsHome: path.join(root, "logs"),
            }),
        });
        try {
            host.registerExtension(storageFixture("test.nologger"));
            await expect(host.activateByEvent("*")).resolves.toBeUndefined();
        } finally {
            host.dispose();
        }
    });

    // Roots are read on EVERY activation: an extension may activate both before
    // and after a folder is opened, and `storageUri` depends exactly on that.
    it("a folder opened after the first activation reaches the next extension", async () => {
        const root = makeRoot();
        let workspaceStorageHome: string | null = null;
        const harness = await createExtensionTestHarness({
            activateEvents: [],
            storageHomes: (): IExtensionStorageHomes => ({
                globalStorageHome: path.join(root, "globalStorage"),
                workspaceStorageHome,
                logsHome: path.join(root, "logs"),
            }),
        });
        try {
            harness.host.registerExtension({ ...storageFixture("test.early"), activationEvents: ["early"] });
            harness.host.registerExtension({ ...storageFixture("test.late"), activationEvents: ["late"] });

            await harness.host.activateByEvent("early");
            const early = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(early.storageFsPath).toBeNull();

            workspaceStorageHome = path.join(root, "workspaceStorage", "hash");
            await harness.host.activateByEvent("late");
            // The second activation re-registers the command to itself, so we read that one.
            const late = (await harness.commandRegistry.execute("test.storage.report")) as IStorageReport;
            expect(late.storageFsPath).toBe(path.join(root, "workspaceStorage", "hash", "test.late"));
        } finally {
            await harness.dispose();
        }
    });
});
