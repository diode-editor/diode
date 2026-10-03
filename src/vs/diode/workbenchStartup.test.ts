import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ITempWorkspace } from "../../TestUtils/TempWorkspace.ts";
import { createTempWorkspace } from "../../TestUtils/TempWorkspace.ts";
import { TestApp } from "../../TestUtils/TestApp.ts";
import { enablePerformanceMarks, getMarks, resetPerformanceMarks } from "../base/common/performance.ts";
import type { IStartupTargets } from "../platform/environment/node/startupTargets.ts";
import type { IExtension } from "../platform/extensions/common/iExtension.ts";
import { KeybindingRegistryDIToken } from "../platform/keybinding/common/keybindingRegistry.ts";
import { computeThemeVars } from "../platform/theme/browser/themeStyleVars.ts";
import { IWorkspaceContextServiceDIToken } from "../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { DiffEditorPane2 } from "../workbench/browser/parts/editor/diffEditorPane2.ts";
import { TextEditorPane } from "../workbench/browser/parts/editor/textEditorPane.ts";
import { WorkbenchComponentDIToken } from "../workbench/browser/workbenchComponent.ts";
import { EditorServiceDIToken } from "../workbench/services/editor/browser/editorService.ts";
import { LifecycleServiceDIToken } from "../workbench/services/lifecycle/browser/lifecycleService.ts";
import { ThemeServiceDIToken } from "../workbench/services/themes/common/themeTokens.ts";

import { createTestContainer } from "./modules/testProfile.ts";
import type { IWorkbenchStartupHost } from "./workbenchStartup.ts";
import { startWorkbench } from "./workbenchStartup.ts";

const NO_TARGETS: IStartupTargets = { folder: undefined, files: [], diff: undefined };

/** Расширение, перебивающее builtin-аккорд Ctrl+P своей командой. */
const KEYBINDING_EXTENSION: IExtension = {
    id: "test.keys",
    location: "user:test.keys/",
    isBuiltin: false,
    manifest: {
        name: "keys",
        publisher: "test",
        version: "1.0.0",
        engines: { vscode: "*" },
        contributes: { keybindings: [{ key: "ctrl+p", command: "test.keys.open" }] },
    },
};

interface IStartup {
    readonly container: ReturnType<typeof createTestContainer>["container"];
    readonly log: string[];
    readonly preloaded: (readonly string[])[];
    /** Отложенный «после первого кадра» колбэк — тест зовёт его сам. */
    firstFrame(): void;
    run(targets: IStartupTargets, extensions?: readonly IExtension[]): Promise<void>;
}

/** Тестовый контейнер + хост, который записывает, в каком порядке его дёргают. */
function setup(): IStartup {
    const { container, bindApp } = createTestContainer();
    const log: string[] = [];
    const preloaded: (readonly string[])[] = [];
    let deferred: (() => void) | undefined;
    const lifecycle = container.get(LifecycleServiceDIToken);
    lifecycle.onDidChangePhase((phase) => log.push(`phase:${phase}`));
    const host: IWorkbenchStartupHost = {
        attachRoot: () => log.push("attachRoot"),
        run: () => {
            log.push("run");
            const workbench = container.get(WorkbenchComponentDIToken);
            const theme = container.get(ThemeServiceDIToken).theme;
            bindApp(TestApp.create(workbench.view, new Size(80, 24), computeThemeVars(theme)).app);
        },
        afterMounted: () => {
            log.push("afterMounted");
            return Promise.resolve();
        },
        preloadGrammars: (files) => {
            log.push("preloadGrammars");
            preloaded.push(files);
            return Promise.resolve();
        },
        afterRestored: () => {
            log.push("afterRestored");
            return Promise.resolve();
        },
        afterFirstFrame: (callback) => {
            log.push("afterFirstFrame");
            deferred = callback;
        },
    };
    return {
        container,
        log,
        preloaded,
        firstFrame: () => deferred?.(),
        run: (targets, extensions = []) => startWorkbench(container, { targets, extensions }, host),
    };
}

function workspaceFolders(startup: IStartup): string[] {
    return startup.container
        .get(IWorkspaceContextServiceDIToken)
        .getWorkspace()
        .folders.map((f) => f.uri.fsPath);
}

describe("startWorkbench", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ files: { "a.ts": "one\ntwo\nthree\n", "b.ts": "b\n" } });
    });

    afterEach(() => {
        ws.dispose();
        resetPerformanceMarks();
    });

    it("проходит шаги и фазы в порядке старта, eventually — только после первого кадра", async () => {
        const startup = setup();

        await startup.run(NO_TARGETS);

        expect(startup.log).toEqual([
            "attachRoot",
            "phase:ready",
            "run",
            "afterMounted",
            "preloadGrammars",
            "phase:restored",
            "afterRestored",
            "afterFirstFrame",
        ]);
        startup.firstFrame();
        expect(startup.log.at(-1)).toBe("phase:eventually");
        expect(startup.container.get(LifecycleServiceDIToken).phase).toBe("eventually");
    });

    it("ставит вехи лестницы старта, которые читает бенч", async () => {
        enablePerformanceMarks();
        const startup = setup();

        await startup.run({ ...NO_TARGETS, files: [{ path: ws.path("a.ts") }] });
        startup.firstFrame();

        // Сервисы по дороге ставят и свои вехи (`textfile:read`, `frame`) — смотрим на лестницу.
        const marks = getMarks().filter((m) => m.name.startsWith("workbench:") || m.name.startsWith("main:"));
        expect(marks.map((m) => m.name)).toEqual([
            "workbench:mounted",
            "workbench:activated",
            "main:grammars-preloaded",
            "main:files-opened",
            "main:startup-complete",
        ]);
        expect(marks.find((m) => m.name === "main:files-opened")?.detail).toEqual({ files: 1 });
    });

    it("keybindings расширений заводятся раньше mount — и перебивают builtin-аккорд", async () => {
        const startup = setup();

        await startup.run(NO_TARGETS, [KEYBINDING_EXTENSION]);

        const resolution = startup.container.get(KeybindingRegistryDIToken).resolveKey({
            key: "p",
            ctrlKey: true,
            shiftKey: false,
            altKey: false,
            metaKey: false,
        });
        expect(resolution).toMatchObject({ kind: "command", commandId: "test.keys.open" });
    });

    it("папка воркспейса назначается до mount (к фазе ready она уже есть)", async () => {
        const startup = setup();
        const lifecycle = startup.container.get(LifecycleServiceDIToken);
        let foldersAtReady: string[] = [];
        lifecycle.onDidChangePhase((phase) => {
            if (phase === "ready") foldersAtReady = workspaceFolders(startup);
        });

        await startup.run({ ...NO_TARGETS, folder: ws.dir });

        expect(foldersAtReady).toEqual([ws.dir]);
    });

    it("без папки окно пустое: сессию не восстанавливает и ничего не греет", async () => {
        const startup = setup();

        await startup.run(NO_TARGETS);

        expect(startup.preloaded).toEqual([[]]);
        expect(workspaceFolders(startup)).toEqual([]);
        expect(startup.container.get(EditorServiceDIToken).getPanes()).toEqual([]);
    });

    it("папка без файлов: греет то, что восстановит сессия (у тестового стора — ничего)", async () => {
        const startup = setup();

        await startup.run({ ...NO_TARGETS, folder: ws.dir });

        expect(startup.preloaded).toEqual([[]]);
    });

    it("явные файлы греются до открытия, открываются по порядку, --goto ставит каретку в последнем", async () => {
        const startup = setup();
        const a = ws.path("a.ts");
        const b = ws.path("b.ts");
        let opened = -1;
        startup.log.push = (entry: string): number => {
            if (entry === "preloadGrammars") opened = startup.container.get(EditorServiceDIToken).getPanes().length;
            return Array.prototype.push.call(startup.log, entry);
        };

        await startup.run({ ...NO_TARGETS, files: [{ path: b }, { path: a, line: 2, column: 3 }] });

        expect(opened).toBe(0);
        expect(startup.preloaded).toEqual([[b, a]]);
        const panes = startup.container.get(EditorServiceDIToken).getPanes();
        expect(panes.map((p) => (p as TextEditorPane).uri.fsPath)).toEqual([b, a]);
        const active = startup.container.get(EditorServiceDIToken).getActiveEditor();
        expect(active?.uri.fsPath).toBe(a);
        expect([active?.primaryCursorLine, active?.primaryCursorColumn]).toEqual([1, 2]);
    });

    it("--goto без колонки ставит каретку в начало строки", async () => {
        const startup = setup();
        const a = ws.path("a.ts");

        await startup.run({ ...NO_TARGETS, files: [{ path: a, line: 3 }] });

        const active = startup.container.get(EditorServiceDIToken).getActiveEditor();
        expect([active?.primaryCursorLine, active?.primaryCursorColumn]).toEqual([2, 0]);
    });

    it("дифф открывается командой vscode.diff, греются обе стороны", async () => {
        const startup = setup();
        const a = ws.path("a.ts");
        const b = ws.path("b.ts");

        await startup.run({ ...NO_TARGETS, folder: ws.dir, files: [{ path: a }], diff: { original: a, modified: b } });

        expect(startup.preloaded).toEqual([[a, b]]);
        const panes = startup.container.get(EditorServiceDIToken).getPanes();
        expect(panes).toHaveLength(1);
        expect(panes[0]).toBeInstanceOf(DiffEditorPane2);
    });
});
