import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Size } from "@tuidom/core/common/geometryPromitives";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../../TestUtils/TestApp.ts";
import type { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../platform/configuration/common/nullConfigurationService.ts";
import { createTestContainer } from "../../diode/modules/testProfile.ts";

import { WorkbenchComponent, WorkbenchComponentDIToken } from "./workbenchComponent.ts";

let savedXdg: string | undefined;
let ws: ITempWorkspace;

// Дерево: dirs-first → row 0 = "target/", row 1 = "a.txt".
function createWorkspace(): ITempWorkspace {
    const workspace = createTempWorkspace({ prefix: "vexx-del-confirm-", files: { "a.txt": "hello" } });
    fs.mkdirSync(workspace.path("target"));
    // Изолированная корзина, чтобы не трогать ~/.local.
    process.env.XDG_DATA_HOME = workspace.path(".xdg");
    return workspace;
}

/** Конфиг-стаб: заданные ключи возвращают свои значения, остальные — default. */
function stubConfig(values: Record<string, unknown>): IConfigurationService {
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            if (key in values) return values[key] as T;
            return defaultValue;
        },
    };
}

interface Ctx {
    testApp: TestApp;
    workbench: WorkbenchComponent;
    commands: CommandRegistry;
}

// Не через createAppTestHarness: конфиг-стаб должен быть забинжен ДО резолва
// Workbench (контроллер читает IConfigurationService в конструкторе,
// а контейнер кэширует уже созданные сервисы).
function createApp(workspaceDir: string | null, config?: IConfigurationService): Ctx {
    const { container, bindApp } = createTestContainer();
    if (config) {
        container.bind(IConfigurationServiceDIToken, () => config);
    }
    const workbench = container.get(WorkbenchComponentDIToken);
    if (workspaceDir !== null) workbench.setWorkspaceFolder(workspaceDir);
    workbench.mount();
    const testApp = TestApp.create(workbench.view, new Size(80, 24));
    bindApp(testApp.app);
    return { testApp, workbench, commands: container.get(CommandRegistryDIToken) };
}

beforeEach(() => {
    savedXdg = process.env.XDG_DATA_HOME;
    ws = createWorkspace();
});

afterEach(() => {
    ws.dispose();
    if (savedXdg === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = savedXdg;
});

async function activate(ctx: Ctx): Promise<void> {
    await ctx.workbench.activate();
    ctx.testApp.render();
    ctx.testApp.querySelector("TreeViewElement")!.focus();
    ctx.testApp.render();
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe.skipIf(process.platform !== "linux")("Delete confirmations — explorer.confirmDelete", () => {
    it("deletes to trash immediately when explorer.confirmDelete=false", async () => {
        const ctx = createApp(ws.dir, stubConfig({ "explorer.confirmDelete": false }));
        await activate(ctx);
        const alpha = ws.path("a.txt");

        ctx.commands.execute("fileOperations.deleteFile", alpha);
        ctx.testApp.render();

        expect(ctx.testApp.querySelector("#confirmDialog")).toBeNull();
        expect(fs.existsSync(alpha)).toBe(false);
        ctx.workbench.dispose();
    });

    it("treats a missing confirmDelete setting as true and asks", async () => {
        // Конфиг возвращает undefined для всех ключей — сервис должен подставить true сам.
        const ctx = createApp(ws.dir, { ...NULL_CONFIGURATION_SERVICE, get: () => undefined });
        await activate(ctx);
        const alpha = ws.path("a.txt");

        ctx.commands.execute("fileOperations.deleteFile", alpha);
        ctx.testApp.render();

        expect(ctx.testApp.querySelector("#confirmDialog")).not.toBeNull();
        expect(fs.existsSync(alpha)).toBe(true);
        ctx.workbench.dispose();
    });

    it("cancelling the dialog keeps the file", async () => {
        const ctx = createApp(ws.dir);
        await activate(ctx);
        const alpha = ws.path("a.txt");

        ctx.commands.execute("fileOperations.deleteFile", alpha);
        ctx.testApp.render();
        expect(ctx.testApp.querySelector("#confirmDialog")).not.toBeNull();

        ctx.testApp.sendKey("Escape");
        ctx.testApp.render();

        expect(ctx.testApp.querySelector("#confirmDialog")).toBeNull();
        expect(fs.existsSync(alpha)).toBe(true);
        ctx.workbench.dispose();
    });

    it("deleteFile without an argument deletes the tree selection", async () => {
        const ctx = createApp(ws.dir);
        await activate(ctx);
        const alpha = ws.path("a.txt");

        ctx.testApp.sendKey("ArrowDown"); // курсор на a.txt
        ctx.commands.execute("fileOperations.deleteFile");
        ctx.testApp.render();
        ctx.testApp.sendKey("Enter"); // дефолтная кнопка — "Move to Trash"
        ctx.testApp.render();

        expect(fs.existsSync(alpha)).toBe(false);
        // Enter, подтвердивший диалог, не должен «протечь» вернувшемуся в фокус дереву
        // и активировать (открыть в редакторе) только что удалённый файл.
        expect(ctx.testApp.focusedElement).toBe(ctx.testApp.querySelector("TreeViewElement"));
        ctx.workbench.dispose();
    });
});

describe("Delete confirmations — permanent delete (no trash)", () => {
    it("warns about permanent deletion and defaults to Cancel", async () => {
        const ctx = createApp(ws.dir, stubConfig({ "files.enableTrash": false }));
        await activate(ctx);
        const alpha = ws.path("a.txt");

        ctx.commands.execute("fileOperations.deleteFile", alpha);
        ctx.testApp.render();

        expect(ctx.testApp.querySelector("#confirmDialog")).not.toBeNull();
        expect(ctx.testApp.backend.screenToString()).toContain("Delete Permanently");

        // Дефолтная кнопка — Cancel: Enter закрывает диалог, файл остаётся.
        ctx.testApp.sendKey("Enter");
        ctx.testApp.render();
        expect(ctx.testApp.querySelector("#confirmDialog")).toBeNull();
        expect(fs.existsSync(alpha)).toBe(true);
        ctx.workbench.dispose();
    });

    it("confirming deletes permanently and records nothing to undo", async () => {
        const ctx = createApp(ws.dir, stubConfig({ "files.enableTrash": false }));
        await activate(ctx);
        const alpha = ws.path("a.txt");

        ctx.commands.execute("fileOperations.deleteFile", alpha);
        ctx.testApp.render();
        ctx.testApp.sendKey("ArrowLeft"); // фокус на "Delete Permanently"
        ctx.testApp.sendKey("Enter");
        ctx.testApp.render();

        expect(fs.existsSync(alpha)).toBe(false);

        // Безвозвратное удаление не отменяемо — undo ничего не возвращает.
        ctx.commands.execute("fileOperations.undo");
        await flush();
        expect(fs.existsSync(alpha)).toBe(false);
        ctx.workbench.dispose();
    });
});

describe.skipIf(process.platform !== "linux")("Workspace undo — confirmation edge cases", () => {
    it("undo with an empty history is a no-op", async () => {
        const ctx = createApp(ws.dir);
        await activate(ctx);

        expect(() => ctx.commands.execute("fileOperations.undo")).not.toThrow();
        ctx.testApp.render();
        expect(ctx.testApp.querySelector("#confirmDialog")).toBeNull();
        ctx.workbench.dispose();
    });

    it("treats a missing confirmUndo setting as true and asks before a destructive undo", async () => {
        const ctx = createApp(ws.dir, { ...NULL_CONFIGURATION_SERVICE, get: () => undefined });
        await activate(ctx);

        // Копируем и вставляем a.txt в target/ — undo такой операции деструктивен.
        ctx.testApp.sendKey("ArrowDown"); // a.txt
        ctx.commands.execute("fileOperations.copy");
        ctx.testApp.sendKey("ArrowUp"); // target/
        ctx.commands.execute("fileOperations.paste");
        expect(fs.existsSync(path.join(ws.dir, "target", "a.txt"))).toBe(true);

        ctx.commands.execute("fileOperations.undo");
        ctx.testApp.render();

        expect(ctx.testApp.querySelector("#confirmDialog")).not.toBeNull();
        ctx.workbench.dispose();
    });
});

describe("File operations without a workspace root (empty selection)", () => {
    it("paste is a no-op (no target directory)", () => {
        const ctx = createApp(null);
        expect(() => ctx.commands.execute("fileOperations.paste")).not.toThrow();
        ctx.workbench.dispose();
    });

    it("copy and cut do nothing without a selection", () => {
        const ctx = createApp(null);
        ctx.commands.execute("fileOperations.copy");
        ctx.commands.execute("fileOperations.cut");

        // Буфер пуст → правый клик по несуществующему дереву невозможен; проверяем
        // косвенно: paste после copy/cut без selection всё ещё no-op.
        expect(() => ctx.commands.execute("fileOperations.paste")).not.toThrow();
        ctx.workbench.dispose();
    });

    it("deleteFile without an argument and without a selection is a no-op", () => {
        const ctx = createApp(null);
        ctx.commands.execute("fileOperations.deleteFile");
        ctx.testApp.render();

        expect(ctx.testApp.querySelector("#confirmDialog")).toBeNull();
        ctx.workbench.dispose();
    });
});

describe.skipIf(process.platform !== "linux")("Workspace redo — empty history", () => {
    it("redo with an empty history is a no-op", async () => {
        const ctx = createApp(ws.dir);
        await activate(ctx);

        expect(() => ctx.commands.execute("fileOperations.redo")).not.toThrow();
        await flush();
        // Файлы на месте, ничего не «повторилось».
        expect(fs.existsSync(ws.path("a.txt"))).toBe(true);
        ctx.workbench.dispose();
    });
});
