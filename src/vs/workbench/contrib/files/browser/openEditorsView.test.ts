import * as path from "node:path";

import { BoxConstraints, Offset, Point, Rect, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { ROOT_STYLE_CONTEXT } from "@tuidom/core/dom/styles/tuiStyle";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";
import { TerminalScreen } from "@tuidom/core/rendering/terminalScreen";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { InMemoryConfigurationService } from "../../../../platform/configuration/common/inMemoryConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import { NERD_FONT_ICONS } from "../../../../platform/theme/common/productIconService.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { IViewsHarness } from "../../../browser/parts/views/viewsService.testUtils.ts";
import { makeViewsHarness, testView } from "../../../browser/parts/views/viewsService.testUtils.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import { EditorGroupsService } from "../../../services/editor/browser/editorGroupsService.ts";
import { MENU_CONTRIBUTIONS } from "../../../workbench.common.main.ts";

import { EXPLORER_VIEWLET_ID } from "./explorerComponent.ts";
import type { OpenEditorsEditorService } from "./openEditorsView.ts";
import { OPEN_EDITORS_VIEW_ID, OpenEditorsView } from "./openEditorsView.ts";

const ROOT = path.join(path.sep, "ws", "project");

class FakePane implements IEditorPane {
    public readonly view = new TUIElement();
    public readonly readOnly = false;
    public readonly label: string;
    public readonly uri: Uri;
    public modifiedValue = false;
    private readonly stateEmitter = new Emitter<void>();

    public constructor(file: string, scheme = "file") {
        this.uri = scheme === "file" ? Uri.file(path.join(ROOT, file)) : Uri.from({ scheme, path: file });
        this.label = path.basename(file);
    }

    public get isModified(): boolean {
        return this.modifiedValue;
    }

    public setModified(modified: boolean): void {
        this.modifiedValue = modified;
        this.stateEmitter.fire();
    }

    public onDidChangeState(cb: () => void): { dispose: () => void } {
        return this.stateEmitter.event(cb);
    }

    public focusEditor(): void {}

    public getSelectedTexts(): string[] {
        return [];
    }

    public dispose(): void {}
}

describe("OpenEditorsView", () => {
    let h: IViewsHarness;
    let groups: EditorGroupsService;
    let config: InMemoryConfigurationService;
    let commands: CommandRegistry;
    let editors: OpenEditorsEditorService & { closed: string[] };
    let view: OpenEditorsView;
    let app: TestApp;

    beforeEach(() => {
        h = makeViewsHarness(MENU_CONTRIBUTIONS);
        h.workspace.setWorkspaceFolder(ROOT);
        groups = new EditorGroupsService(NULL_LOG_SERVICE, createTestConfigurationService());
        config = createTestConfigurationService();
        commands = new CommandRegistry();
        const closed: string[] = [];
        editors = {
            closed,
            displayName: (pane) => pane.label,
            closeEditor: (group, target) => {
                const pane = typeof target === "number" ? group.getPane(target) : target;
                closed.push(pane?.label ?? "");
                group.closeTab(group.getPanes().indexOf(pane!));
                return Promise.resolve(true);
            },
            closeAllEditors: (group) => {
                for (const pane of [...group.getPanes()].reverse()) {
                    closed.push(pane.label);
                    group.closeTab(group.getPanes().indexOf(pane));
                }
                return Promise.resolve(true);
            },
        };
        h.service.registerContainer({ id: EXPLORER_VIEWLET_ID, title: "EXPLORER", location: "sidebar" });
        h.service.registerView(testView("files", EXPLORER_VIEWLET_ID, 10));
        view = new OpenEditorsView(h.service, groups, editors, commands, config, h.workspace);
        h.service.attachContainer(EXPLORER_VIEWLET_ID);
        h.showViewlet(EXPLORER_VIEWLET_ID);
        app = TestApp.createWithContent(h.root(EXPLORER_VIEWLET_ID), new Size(40, 24));
    });

    afterEach(() => {
        view.dispose();
        groups.dispose();
    });

    function open(group: EditorGroup, ...files: string[]): FakePane[] {
        return files.map((file) => {
            const pane = new FakePane(file);
            group.insertPane(pane);
            group.activateTab(group.editorCount - 1, { focus: false });
            return pane;
        });
    }

    function show(): void {
        h.service.setViewVisible(OPEN_EDITORS_VIEW_ID, true);
    }

    async function screen(): Promise<string[]> {
        // The tree reloads asynchronously on every change (a chain of promises): a macrotask drains it.
        await new Promise((resolve) => setTimeout(resolve, 0));
        app.render();
        return app.backend
            .screenToString()
            .split("\n")
            .map((line) => line.trimEnd());
    }

    /** The rows of the section body (between its header and the next one). */
    async function rows(): Promise<string[]> {
        const lines = await screen();
        const start = lines.findIndex((line) => line.includes("OPEN EDITORS"));
        const end = lines.findIndex((line, index) => index > start && line.includes("FILES"));
        return lines.slice(start + 1, end);
    }

    /** Rows without file icons and the cursor row's ×, spaces collapsed: "a.ts src". */
    async function texts(): Promise<string[]> {
        return (await rows()).map((line) =>
            line
                .replace(/[\uE000-\uF8FF]/gu, "")
                .replace(/ \u00D7$/u, "")
                .trim()
                .replace(/ +/gu, " "),
        );
    }

    function key(name: string): void {
        list().dispatchEvent(new TUIKeyboardEvent("keypress", { key: name }));
    }

    /** The pane under the list's cursor, or the group row's label. */
    function cursor(): string | undefined {
        const element = view.getFocusedElement();
        return element?.kind === "group" ? element.label : element?.pane.label;
    }

    function list(): TUIElement {
        return app.querySelector("#openEditorsList")!;
    }

    function mouse(
        type: "click" | "dblclick" | "mousemove",
        x: number,
        y: number,
        button: "left" | "middle" | "none" = "left",
    ): void {
        list().dispatchEvent(new TUIMouseEvent(type, { button, screenX: x, screenY: y, localX: x, localY: y }));
    }

    it("is hidden by default: the Explorer shows only the file tree, the menu offers it unchecked", () => {
        expect(h.paneView(EXPLORER_VIEWLET_ID).getPaneIds()).toEqual(["files"]);
        expect(h.service.getContainerViews(EXPLORER_VIEWLET_ID)[0]).toEqual({
            id: OPEN_EDITORS_VIEW_ID,
            title: "OPEN EDITORS",
            visible: false,
            canToggleVisibility: true,
        });
        expect(h.service.canMoveView(OPEN_EDITORS_VIEW_ID)).toBe(true);
    });

    it("shown, it sits above the files and lists the tabs with their folders, sized to the rows", async () => {
        open(groups.activeGroup, "src/a.ts", "b.ts", "src/lib/c.ts");
        show();

        expect(h.paneView(EXPLORER_VIEWLET_ID).getPaneIds()).toEqual([OPEN_EDITORS_VIEW_ID, "files"]);
        expect(await texts()).toEqual(["a.ts src", "b.ts", "c.ts src/lib"]);
    });

    it("the component's view is the scrolling list the section mounts", async () => {
        open(groups.activeGroup, "a.ts");
        show();
        await screen();

        expect(view.view.id).toBe("openEditorsView");
        expect(app.querySelector("#openEditorsView")).toBe(view.view);
        expect(view.view.querySelector("#openEditorsList")).toBe(list());
    });

    it("a modified editor keeps ● at the row's end; saving it removes the dot", async () => {
        const [a] = open(groups.activeGroup, "a.ts", "b.ts");
        show();
        a.setModified(true);

        expect((await rows())[0]).toMatch(/a\.ts +●$/u);
        a.setModified(false);
        expect((await rows())[0]).toMatch(/a\.ts$/u);
    });

    it("two groups: a Group N row above each group's tabs; one group again — no group rows", async () => {
        open(groups.activeGroup, "a.ts");
        const second = groups.addGroup(groups.activeGroup, "after")!;
        open(second, "b.ts", "c.ts");
        show();

        expect(await texts()).toEqual(["Group 1", "a.ts", "Group 2", "b.ts", "c.ts"]);

        await editors.closeAllEditors(second);
        expect(await texts()).toEqual(["a.ts"]);
    });

    it("a click on a row activates its tab and group, keeping focus in the list", async () => {
        const [a] = open(groups.activeGroup, "a.ts", "b.ts");
        show();
        await rows();
        h.service.openView(OPEN_EDITORS_VIEW_ID, true);

        mouse("click", 3, 0);

        expect(groups.activeGroup.activePane).toBe(a);
        expect(app.focusedElement).toBe(list());
    });

    it("× on a row closes that editor; a middle click too", async () => {
        open(groups.activeGroup, "a.ts", "b.ts", "c.ts");
        show();
        await rows();
        const width = list().layoutSize.width;

        mouse("mousemove", 3, 0, "none");
        mouse("click", width - 1, 0);
        expect(editors.closed).toEqual(["a.ts"]);
        expect(await texts()).toEqual(["b.ts", "c.ts"]);

        mouse("click", 3, 1, "middle");
        expect(editors.closed).toEqual(["a.ts", "c.ts"]);
        expect(await texts()).toEqual(["b.ts"]);
    });

    it("a preview tab's name is italic", async () => {
        groups.activeGroup.insertPane(new FakePane("preview.ts"), { preview: true });
        open(groups.activeGroup, "pinned.ts");
        show();
        await rows();
        const tree = list();
        const size = new Size(tree.layoutSize.width, 2);
        const terminal = new TerminalScreen(size);
        tree.layout(BoxConstraints.tight(size));
        tree.performStyleResolution(ROOT_STYLE_CONTEXT);
        tree.render(new RenderContext(terminal, new Offset(0, 0), new Rect(new Point(0, 0), size)));
        const styleOf = (row: number): number => {
            const text = Array.from({ length: size.width }, (_, x) => terminal.getCell(new Point(x, row)).char).join(
                "",
            );
            return terminal.getCell(new Point(text.indexOf(row === 0 ? "preview" : "pinned"), row)).style;
        };

        expect(styleOf(0) & StyleFlags.Italic).toBe(StyleFlags.Italic);
        expect(styleOf(1) & StyleFlags.Italic).toBe(0);
    });

    it("explorer.openEditors.sortOrder: alphabetical sorts by name, fullPath by path", async () => {
        open(groups.activeGroup, "z/b.ts", "a/c.ts", "y/a10.ts", "y/a9.ts");
        show();
        const names = async (): Promise<string[]> => (await texts()).map((line) => line.split(" ")[0]);

        await config.updateValue("explorer.openEditors.sortOrder", "alphabetical");
        expect(await names()).toEqual(["a9.ts", "a10.ts", "b.ts", "c.ts"]);
        await config.updateValue("explorer.openEditors.sortOrder", "fullPath");
        expect(await names()).toEqual(["c.ts", "a9.ts", "a10.ts", "b.ts"]);
    });

    it("an untitled editor has no folder; a non-file editor comes first under fullPath", async () => {
        const group = groups.activeGroup;
        open(group, "src/a.ts");
        group.insertPane(new FakePane("Untitled-1", "untitled"));
        await config.updateValue("explorer.openEditors.sortOrder", "fullPath");
        show();

        expect(await texts()).toEqual(["Untitled-1", "a.ts src"]);
    });

    it("explorer.openEditors.visible caps the initial height; the rest scrolls", async () => {
        open(groups.activeGroup, ...Array.from({ length: 12 }, (_, i) => `f${i}.ts`));
        show();

        expect(await rows()).toHaveLength(9);
        await config.updateValue("explorer.openEditors.visible", 4);
        expect(await rows()).toHaveLength(4);
    });

    it("explorer.openEditors.minVisible pre-allocates rows", async () => {
        await config.updateValue("explorer.openEditors.minVisible", 5);
        open(groups.activeGroup, "a.ts");
        show();

        const body = await rows();
        expect(body).toHaveLength(5);
        expect(body.slice(1).every((line) => line.trim() === "")).toBe(true);
    });

    it("group row buttons: Save All in Group runs the command with the group, Close Group closes its tabs", async () => {
        open(groups.activeGroup, "a.ts");
        const second = groups.addGroup(groups.activeGroup, "after")!;
        open(second, "b.ts", "c.ts");
        const saveAllInGroup = vi.fn();
        commands.register("workbench.files.action.saveAllInGroup", saveAllInGroup);
        show();
        await rows();
        const width = list().layoutSize.width;
        const click = (x: number, y: number): void => {
            mouse("mousemove", 3, y, "none");
            mouse("click", x, y);
        };

        click(width - 3, 2);
        expect(saveAllInGroup).toHaveBeenCalledWith(second.id);
        click(width - 1, 2);
        expect(editors.closed).toEqual(["c.ts", "b.ts"]);
    });

    it("openEditorsFocus is set while the list has focus", async () => {
        open(groups.activeGroup, "a.ts");
        show();
        await rows();
        const keys = new ContextKeyService();

        view.updateContextKeys(keys, null);
        expect(keys.evaluate("openEditorsFocus")).toBe(false);
        h.service.openView(OPEN_EDITORS_VIEW_ID, true);
        view.updateContextKeys(keys, app.focusedElement);
        expect(keys.evaluate("openEditorsFocus")).toBe(true);
    });

    it("a click activates the tab without pinning it; Enter and a double click pin it and focus the editor", async () => {
        const group = groups.activeGroup;
        const preview = new FakePane("preview.ts");
        group.insertPane(preview, { preview: true });
        const [b] = open(group, "b.ts");
        show();
        await rows();
        const focusGroup = vi.spyOn(groups, "focusGroup");
        const activateTab = vi.spyOn(group, "activateTab");

        mouse("click", 3, 0);
        expect(group.activePane).toBe(preview);
        expect(group.isPinned(preview)).toBe(false);
        expect(focusGroup).toHaveBeenLastCalledWith(group.id, { focus: false });
        expect(activateTab).toHaveBeenLastCalledWith(0, { focus: false });

        key("Enter");
        expect(group.isPinned(preview)).toBe(true);
        expect(activateTab).toHaveBeenLastCalledWith(0, { focus: true });

        mouse("dblclick", 3, 1);
        expect(group.activePane).toBe(b);
        expect(activateTab).toHaveBeenLastCalledWith(1, { focus: true });
    });

    it("a group row: a click activates its group keeping focus, Enter focuses it; a middle click closes nothing", async () => {
        open(groups.activeGroup, "a.ts");
        const second = groups.addGroup(groups.activeGroup, "after")!;
        open(second, "b.ts");
        const first = groups.groups[0];
        groups.focusGroup(first.id, { focus: false });
        show();
        await rows();
        const focusGroup = vi.spyOn(groups, "focusGroup");

        mouse("click", 3, 2);
        expect(groups.activeGroup).toBe(second);
        expect(focusGroup).toHaveBeenLastCalledWith(second.id, { focus: false });
        key("Enter");
        expect(focusGroup).toHaveBeenLastCalledWith(second.id, { focus: true });

        mouse("click", 3, 0, "middle");
        expect(editors.closed).toEqual([]);
        expect(await texts()).toEqual(["Group 1", "a.ts", "Group 2", "b.ts"]);
    });

    it("workbench.list.openMode doubleClick: a single click only moves the cursor", async () => {
        await config.updateValue("workbench.list.openMode", "doubleClick");
        open(groups.activeGroup, "a.ts", "b.ts");
        show();
        await rows();

        mouse("click", 3, 0);
        expect(cursor()).toBe("a.ts");
        expect(groups.activeGroup.activePane?.label).toBe("b.ts");
    });

    it("the cursor follows the active editor: another tab, another group", async () => {
        const [a] = open(groups.activeGroup, "a.ts", "b.ts");
        const second = groups.addGroup(groups.activeGroup, "after")!;
        open(second, "c.ts");
        groups.focusGroup(second.id, { focus: false });
        show();
        await rows();
        expect(cursor()).toBe("c.ts");

        groups.focusGroup(groups.groups[0].id, { focus: false });
        await rows();
        expect(cursor()).toBe("b.ts");

        groups.groups[0].activateTab(groups.groups[0].getPanes().indexOf(a), { focus: false });
        await rows();
        expect(cursor()).toBe("a.ts");
    });

    it("a changed workspace folder changes the folders on the rows", async () => {
        open(groups.activeGroup, "src/a.ts");
        show();
        expect(await texts()).toEqual(["a.ts src"]);

        h.workspace.setWorkspaceFolder(path.join(ROOT, "src"));
        expect(await texts()).toEqual(["a.ts"]);
    });

    it("an unrelated setting leaves the cursor where the user moved it", async () => {
        open(groups.activeGroup, "a.ts", "b.ts");
        show();
        await rows();
        h.service.openView(OPEN_EDITORS_VIEW_ID, true);
        key("ArrowUp");
        expect(cursor()).toBe("a.ts");

        await config.updateValue("editor.tabSize", 8);
        await rows();
        expect(cursor()).toBe("a.ts");
    });

    it("a setting of the wrong type falls back to its default", async () => {
        open(groups.activeGroup, ...Array.from({ length: 12 }, (_, i) => `f${i}.ts`));
        await config.updateValue("explorer.openEditors.visible", "4");
        show();

        expect(await rows()).toHaveLength(9);
    });

    it("an editor without a file icon shows its name alone", async () => {
        view.dispose();
        h.service.unregisterView(OPEN_EDITORS_VIEW_ID);
        const icons = Object.create(NERD_FONT_ICONS) as typeof NERD_FONT_ICONS;
        icons.fileIcon = () => undefined;
        view = new OpenEditorsView(h.service, groups, editors, commands, config, h.workspace, icons);
        open(groups.activeGroup, "a.ts");
        show();

        expect(await texts()).toEqual(["a.ts"]);
    });

    it("tabs open before the section was created are listed at once", async () => {
        view.dispose();
        h.service.unregisterView(OPEN_EDITORS_VIEW_ID);
        open(groups.activeGroup, "a.ts", "b.ts");
        view = new OpenEditorsView(h.service, groups, editors, commands, config, h.workspace);
        show();

        expect(await texts()).toEqual(["a.ts", "b.ts"]);
    });

    it("fullPath puts non-file editors first from either side of the comparison", async () => {
        const group = groups.activeGroup;
        group.insertPane(new FakePane("Untitled-2", "untitled"));
        open(group, "a.ts");
        group.insertPane(new FakePane("Untitled-1", "untitled"));
        await config.updateValue("explorer.openEditors.sortOrder", "fullPath");
        show();

        expect(await texts()).toEqual(["Untitled-1", "Untitled-2", "a.ts"]);
    });
});
