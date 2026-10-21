import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../TestUtils/testConfigurationService.ts";
import { MenuId } from "../../platform/actions/common/menuId.ts";
import { MenuRegistryDIToken } from "../../platform/actions/common/menuRegistry.ts";
import { MenuServiceDIToken } from "../../platform/actions/common/menuService.ts";
import type { InMemoryConfigurationService } from "../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyServiceDIToken } from "../../platform/contextkey/common/contextKeyService.ts";
import { EditorGroupsServiceDIToken } from "../services/editor/common/editorGroupsService.ts";
import { ThemeServiceDIToken } from "../services/themes/common/themeTokens.ts";

import type { EditorTitleBarMenuContext } from "./actions/menuContexts.ts";

// Shaped like the stock Claude Code extension's contribution: accept/reject with `$(check)`/`$(discard)`
// and an item without a drawable icon (SVG), which goes into "⋯".

const CHECK = "";
const DISCARD = "";
const WIDTH = 80;

function click(x: number, y: number, action: "press" | "release"): MouseToken {
    return {
        kind: "mouse",
        button: "left",
        x: x + 1,
        y: y + 1,
        action,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    };
}

describe("Workbench — панель действий группы (editor/title)", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    const runs: string[] = [];
    let configuration: InMemoryConfigurationService;

    function boot(settings: Readonly<Record<string, unknown>> = {}): void {
        ws = createTempWorkspace({ prefix: "diode-editor-title-", files: { "a.txt": "alpha\n" } });
        configuration = createTestConfigurationService(settings);
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            openFile: ws.path("a.txt"),
            size: new Size(WIDTH, 16),
            configurationService: configuration,
        });
        runs.length = 0;
        for (const id of ["demo.accept", "demo.reject", "demo.open"]) {
            h.commands.register(id, (...args: unknown[]) => {
                runs.push(`${id}${args.length > 0 ? ` ${JSON.stringify(args)}` : ""}`);
            });
        }
        const menus = h.container.get(MenuRegistryDIToken);
        const when = "demo.viewingProposedDiff";
        menus.appendMenuItem({
            menuId: MenuId.EditorTitle,
            command: "demo.accept",
            title: "Accept",
            group: "navigation",
            icon: CHECK,
            when,
        });
        menus.appendMenuItem({
            menuId: MenuId.EditorTitle,
            command: "demo.reject",
            title: "Reject",
            group: "navigation",
            icon: DISCARD,
            when,
        });
        menus.appendMenuItem({
            menuId: MenuId.EditorTitle,
            command: "demo.open",
            title: "Open Agent",
            group: "navigation",
            when: "demo.useTerminal",
        });
    }

    const keys = () => h.container.get(ContextKeyServiceDIToken);
    const flush = (): Promise<void> =>
        new Promise((resolve) => {
            queueMicrotask(resolve);
        });
    const tabRow = (): string => {
        h.testApp.render();
        return h.testApp.backend.screenToString().split("\n")[1];
    };

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("без видимых пунктов ряд вкладок прежний; when включился — кнопки справа от вкладок", async () => {
        boot();
        const before = tabRow();
        expect(before).not.toContain(CHECK);
        expect(h.testApp.querySelector("#editorTitleActions-1")).toBeNull();

        keys().setRaw("demo.viewingProposedDiff", true);
        await flush();
        const row = tabRow();
        expect(row).toContain("a.txt");
        expect(row.trimEnd().endsWith(` ${CHECK} │ ${DISCARD}`)).toBe(true);
        expect(row.indexOf(CHECK)).toBeGreaterThan(row.indexOf("a.txt"));

        keys().setRaw("demo.viewingProposedDiff", false);
        await flush();
        expect(tabRow()).toBe(before);
    });

    it("workbench.editor.editorActionsLocation: hidden и titleBar прячут панель, default — показывает", async () => {
        boot({ "workbench.editor.editorActionsLocation": "hidden" });
        keys().setRaw("demo.viewingProposedDiff", true);
        await flush();
        expect(tabRow()).not.toContain(CHECK);

        await configuration.updateValue("workbench.editor.editorActionsLocation", "titleBar");
        expect(tabRow()).not.toContain(CHECK);

        await configuration.updateValue("workbench.editor.editorActionsLocation", "default");
        expect(tabRow()).toContain(CHECK);
    });

    it("клик по кнопке исполняет её команду", async () => {
        boot();
        keys().setRaw("demo.viewingProposedDiff", true);
        await flush();
        const x = tabRow().indexOf(DISCARD);
        h.testApp.backend.simulateMouse(click(x, 1, "press"));
        h.testApp.backend.simulateMouse(click(x, 1, "release"));
        expect(runs).toStrictEqual(["demo.reject"]);
    });

    it("пункт без иконки — в «⋯»: попап с подписью, выбор исполняет команду", async () => {
        boot();
        keys().setRaw("demo.useTerminal", true);
        await flush();
        const row = tabRow();
        expect(row.trimEnd().endsWith("⋯")).toBe(true);
        const x = row.lastIndexOf("⋯");
        h.testApp.backend.simulateMouse(click(x, 1, "press"));
        h.testApp.backend.simulateMouse(click(x, 1, "release"));
        h.testApp.render();
        expect(h.testApp.backend.screenToString()).toContain("Open Agent");
        h.testApp.sendKey("Enter");
        expect(runs).toStrictEqual(["demo.open"]);
    });

    it("панель — без подписи, в цвете ряда вкладок и вне Tab-обхода", async () => {
        boot();
        keys().setRaw("demo.viewingProposedDiff", true);
        await flush();
        const row = tabRow();
        expect(row.slice(row.indexOf("a.txt") + "a.txt".length, row.indexOf(CHECK))).toMatch(/^ ×[\s│]*$/u);
        const panel = h.testApp.querySelector("#editorTitleActions-1");
        expect(panel?.focusable).toBe(false);
        const tabsBg = h.container.get(ThemeServiceDIToken).theme.getRequiredColor("editorGroupHeader.tabsBackground");
        expect(panel?.resolvedStyle.bg).toBe(tabsBg);
    });

    it("пункт, заведённый после старта, появляется без смены контекста", async () => {
        boot();
        await flush();
        h.container.get(MenuRegistryDIToken).appendMenuItem({
            menuId: MenuId.EditorTitle,
            command: "demo.accept",
            group: "navigation",
            icon: CHECK,
        });
        await flush();
        expect(tabRow()).toContain(CHECK);
    });

    it("новая группа приходит с панелью сразу", async () => {
        boot();
        keys().setRaw("demo.viewingProposedDiff", true);
        await flush();
        h.commands.execute("workbench.action.splitEditor");
        expect(tabRow().split(CHECK)).toHaveLength(3);
    });

    it("чужая настройка панель не пере-резолвит", async () => {
        boot();
        await flush();
        const resolve = vi.spyOn(h.container.get(MenuServiceDIToken), "getEntryGroups");
        await configuration.updateValue("editor.tabSize", 2);
        expect(resolve.mock.calls.filter(([menuId]) => menuId === MenuId.EditorTitle)).toStrictEqual([]);
    });

    it("у каждой группы своя панель; пункт видит свою группу в контексте", async () => {
        boot();
        h.commands.execute("workbench.action.splitEditor");
        const groups = h.container.get(EditorGroupsServiceDIToken).groups;
        const seen: number[] = [];
        h.container.get(MenuRegistryDIToken).appendMenuItem({
            menuId: MenuId.EditorTitle,
            command: "demo.accept",
            group: "navigation",
            icon: CHECK,
            visible: (context) => {
                seen.push((context as EditorTitleBarMenuContext).groupId);
                return true;
            },
        });
        await flush();
        expect(h.testApp.querySelector(`#editorTitleActions-${String(groups[0].id)}`)).not.toBeNull();
        expect(h.testApp.querySelector(`#editorTitleActions-${String(groups[1].id)}`)).not.toBeNull();
        expect(new Set(seen)).toStrictEqual(new Set(groups.map((g) => g.id)));
        expect(tabRow().split(CHECK)).toHaveLength(3);
    });
});
