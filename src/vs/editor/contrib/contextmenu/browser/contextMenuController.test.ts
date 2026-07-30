import { describe, expect, it } from "vitest";

import { Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIContextMenuEvent } from "../../../../../../tuidom/dom/events/tuiMouseEvent.ts";
import type { MouseToken } from "../../../../../../tuidom/input/rawTerminalToken.ts";
import type { MenuItemEntry, PopupMenuElement } from "../../../../../../tuidom/ui/menu/popupMenuElement.ts";
import { ScrollBarDecorator } from "../../../../../../tuidom/ui/scrollbar/scrollContainerElement.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { MENU_CONTRIBUTIONS } from "../../../../workbench/browser/actions/menuContributions.ts";
import { MenuRegistry } from "../../../../platform/actions/common/menuRegistry.ts";
import { MenuService } from "../../../../platform/actions/common/menuService.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { EditorElement } from "../../../browser/editorElement.ts";
import { createSelection } from "../../../common/core/iSelection.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";
import { EditorViewState } from "../../../common/viewModel/editorViewState.ts";

import { ContextMenuController } from "./contextMenuController.ts";

interface ISetup {
    app: TestApp;
    editor: EditorElement;
    view: ScrollBarDecorator;
    executed: string[];
}

function setup(text = "hello world\nsecond line", configuration?: IConfigurationService): ISetup {
    const doc = new TextDocument(text);
    const editor = new EditorElement(new EditorViewState(doc));
    editor.focusable = true;
    const view = new ScrollBarDecorator(editor);
    const app = TestApp.createWithContent(view, new Size(50, 12));

    const commands = new CommandRegistry();
    const executed: string[] = [];
    for (const [id, title] of [
        ["editor.action.clipboardCopyAction", "Copy"],
        ["editor.action.clipboardCutAction", "Cut"],
        ["editor.action.clipboardPasteAction", "Paste"],
        ["undo", "Undo"],
    ] as const) {
        commands.register(id, () => executed.push(id), title);
    }
    const contextMenuService = new ContextMenuService(
        new MenuService(new MenuRegistry(commands, new KeybindingRegistry(), new ContextKeyService(), MENU_CONTRIBUTIONS)),
    );
    const controller = new ContextMenuController(contextMenuService, configuration ?? NULL_CONFIGURATION_SERVICE);
    controller.attach(view);

    return { app, editor, view, executed };
}

/** Правый press+release по локальной точке редактора — честный мышиный путь. */
function rightClick(app: TestApp, editor: EditorElement, localX: number, localY: number): void {
    const x = editor.globalPosition.x + localX + 1; // MouseToken 1-based
    const y = editor.globalPosition.y + localY + 1;
    const token = (action: MouseToken["action"]): MouseToken => ({
        kind: "mouse",
        button: "right",
        action,
        x,
        y,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        raw: "",
    });
    app.backend.simulateMouse(token("press"));
    app.backend.simulateMouse(token("release"));
}

function keyboardTrigger(editor: EditorElement): void {
    editor.dispatchEvent(
        new TUIContextMenuEvent({
            trigger: "keyboard",
            button: "none",
            screenX: editor.globalPosition.x,
            screenY: editor.globalPosition.y,
            localX: 0,
            localY: 0,
        }),
    );
}

function openPopup(app: TestApp): PopupMenuElement | null {
    const items = app.root.overlayLayer.getItems();
    return items.length > 0 ? (items[items.length - 1].element as PopupMenuElement) : null;
}

const GUTTER = 6; // гуттер двухстрочного документа: 2 паддинга + номер + fold-маржин

describe("editor/contrib/contextmenu — ContextMenuController", () => {
    it("opens the EditorContext menu on right press+release and focuses the editor", () => {
        const { app, editor } = setup();

        rightClick(app, editor, GUTTER + 2, 0);

        const popup = openPopup(app);
        expect(popup).not.toBeNull();
        expect(popup?.entries.map((e) => (e.type === "separator" ? "─" : e.label))).toEqual([
            "Copy",
            "Cut",
            "Paste",
            "─",
            "Undo",
        ]);
        expect(editor.isFocused).toBe(false); // фокус на попапе, вернётся при закрытии
    });

    it("moves the caret to the click position when it is outside the selection", () => {
        const { app, editor } = setup();

        rightClick(app, editor, GUTTER + 6, 1);

        expect(editor.viewState.selections[0].active).toEqual({ line: 1, character: 6 });
    });

    it("keeps the selection when the click lands inside it", () => {
        const { app, editor } = setup();
        editor.viewState.selections = [createSelection(0, 1, 0, 8)];

        rightClick(app, editor, GUTTER + 4, 0);

        expect(editor.viewState.selections[0]).toMatchObject({
            anchor: { line: 0, character: 1 },
            active: { line: 0, character: 8 },
        });
    });

    it("selecting an entry executes its command", () => {
        const { app, editor, executed } = setup();

        rightClick(app, editor, GUTTER + 2, 0);
        const popup = openPopup(app);
        popup?.entries
            .find((e): e is MenuItemEntry => e.type !== "separator" && e.label === "Copy")
            ?.onSelect?.();

        expect(executed).toEqual(["editor.action.clipboardCopyAction"]);
        expect(app.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("keyboard trigger anchors the menu at the caret", () => {
        const { app, editor } = setup();
        editor.viewState.selections = [createSelection(1, 3, 1, 3)];
        app.render();

        keyboardTrigger(editor);

        const items = app.root.overlayLayer.getItems();
        expect(items.length).toBe(1);
        const caret = editor.getCaretScreenCell();
        expect(caret).not.toBeNull();
        // Попап открыт строкой ниже якоря (preferBelow), по x — от каретки.
        expect(items[0].position.x).toBe(caret!.x);
        expect(items[0].position.y).toBe(caret!.y + 1);
    });

    it("keyboard trigger falls back to the editor origin when the caret is scrolled out", () => {
        const { app, editor } = setup(Array.from({ length: 50 }, (_, i) => `line ${String(i)}`).join("\n"));
        editor.viewState.selections = [createSelection(0, 0, 0, 0)];
        editor.viewState.scrollTop = 30; // каретка (строка 0) вне вьюпорта
        app.render();

        keyboardTrigger(editor);

        expect(app.root.overlayLayer.getItems().length).toBe(1);
    });

    it("editor.contextmenu: false only places the caret and opens nothing", () => {
        const config = {
            ...NULL_CONFIGURATION_SERVICE,
            get: <T>(key: string, defaultValue?: T): T | undefined =>
                key === "editor.contextmenu" ? (false as T) : defaultValue,
        };
        const { app, editor } = setup(undefined, config);

        rightClick(app, editor, GUTTER + 6, 0);

        expect(app.root.overlayLayer.hasVisibleItems()).toBe(false);
        expect(editor.viewState.selections[0].active).toEqual({ line: 0, character: 6 });
        expect(editor.isFocused).toBe(true);
    });

    it("ignores contextmenu events whose target is not inside an editor", () => {
        const { app, view } = setup();

        view.dispatchEvent(
            new TUIContextMenuEvent({
                trigger: "mouse",
                button: "right",
                screenX: 0,
                screenY: 0,
                localX: 0,
                localY: 0,
            }),
        );

        expect(app.root.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("ignores an already-prevented contextmenu event", () => {
        const { app, editor } = setup();
        editor.addEventListener("contextmenu", (e) => e.preventDefault(), { capture: true });

        rightClick(app, editor, GUTTER + 2, 0);

        expect(app.root.overlayLayer.hasVisibleItems()).toBe(false);
    });
});
