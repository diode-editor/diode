import type { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { MenuEntry, MenuItemEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it, vi } from "vitest";

import { renderElement } from "../../../../../TestUtils/renderElement.ts";
import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type { IContextMenuDelegate } from "../../../../platform/contextview/common/contextMenuDelegate.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { chordsEqual, KeybindingRegistry, parseChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type {
    IKeybindingMutationResult,
    IKeybindingsEditorService,
} from "../../../services/keybinding/common/iKeybindingsEditorService.ts";

import { KEYBINDINGS_EDITOR_SCHEME, KeybindingsEditorPane, keybindingsEditorUri } from "./keybindingsEditorPane.ts";

/** Сервис-фейк: вызовы записываются, исход задаётся тестом. */
class FakeService implements IKeybindingsEditorService {
    public defines: { commandId: string; chord: KeybindingChord; previous?: IKeybindingEntrySnapshot }[] = [];
    public removed: IKeybindingEntrySnapshot[] = [];
    public resets: string[] = [];
    public userModified = new Set<string>();
    public result: IKeybindingMutationResult = { ok: true };
    private readonly listeners = new Set<() => void>();

    public applyUserKeybindings(): void {}

    public defineKeybinding(
        commandId: string,
        chord: KeybindingChord,
        previous?: IKeybindingEntrySnapshot,
    ): Promise<IKeybindingMutationResult> {
        this.defines.push({ commandId, chord, previous });
        return Promise.resolve(this.result);
    }

    public removeKeybinding(entry: IKeybindingEntrySnapshot): Promise<IKeybindingMutationResult> {
        this.removed.push(entry);
        return Promise.resolve(this.result);
    }

    public resetKeybinding(commandId: string): Promise<IKeybindingMutationResult> {
        this.resets.push(commandId);
        return Promise.resolve(this.result);
    }

    public hasUserModifications(commandId: string): boolean {
        return this.userModified.has(commandId);
    }

    public onDidChange(cb: () => void): { dispose: () => void } {
        this.listeners.add(cb);
        return { dispose: () => this.listeners.delete(cb) };
    }

    public emit(): void {
        for (const listener of [...this.listeners]) listener();
    }

    public dispose(): void {}
}

class FakeRecorder {
    /** Что вернёт следующий record(); null — отмена. */
    public nextChord: KeybindingChord | null = null;
    public recordedTitles: string[] = [];

    public record(commandTitle: string): Promise<KeybindingChord | null> {
        this.recordedTitles.push(commandTitle);
        return Promise.resolve(this.nextChord);
    }
}

interface IHarness {
    pane: KeybindingsEditorPane;
    registry: KeybindingRegistry;
    service: FakeService;
    recorder: FakeRecorder;
    shownMenus: IContextMenuDelegate[];
    copied: string[];
    render(): string;
    /** Активация строки по тексту её команды (Enter/двойной клик). */
    activateRowOf(title: string): void;
    /** Контекст-меню строки по тексту её команды; возвращает пункты. */
    menuOf(title: string): MenuEntry[];
}

function makeHarness(): IHarness {
    const registry = new KeybindingRegistry();
    const commands = new CommandRegistry();
    commands.register("save", () => {}, "Save File");
    commands.register("hover", () => {}, "Show Hover");
    commands.register("unbound", () => {}, "Never Bound");
    registry.register(parseChord("ctrl+s"), "save");
    registry.register(parseChord("ctrl+k ctrl+u"), "hover", "textViewFocus", "extension");

    const service = new FakeService();
    const recorder = new FakeRecorder();
    const shownMenus: IContextMenuDelegate[] = [];
    const contextMenu = {
        showContextMenu: (delegate: IContextMenuDelegate) => {
            shownMenus.push(delegate);
        },
    } as unknown as ContextMenuService;
    const copied: string[] = [];
    const clipboard: IClipboard = {
        readText: () => Promise.resolve(""),
        writeText: (text) => {
            copied.push(text);
            return Promise.resolve();
        },
    };

    const pane = new KeybindingsEditorPane(registry, commands, service, recorder, contextMenu, clipboard);

    const rowOf = (title: string) => {
        const rows = pane.view.querySelectorAll("TextLabelElement");
        const row = rows.find((candidate) => (candidate as { getText(): string }).getText().startsWith(title));
        expect(row, `строка «${title}» не найдена`).toBeDefined();
        return row!;
    };

    return {
        pane,
        registry,
        service,
        recorder,
        shownMenus,
        copied,
        render: () => renderElement(pane.view, 80, 14, { themeVars: true }).screenToString(),
        activateRowOf: (title) => {
            const list = pane.view.querySelector("#keybindingsList")!;
            (list as unknown as { onActivate: ((el: unknown) => void) | null }).onActivate?.(rowOf(title));
        },
        menuOf: (title) => {
            const list = pane.view.querySelector("#keybindingsList")!;
            (
                list as unknown as {
                    onContextMenu: ((el: unknown, x: number, y: number) => void) | null;
                }
            ).onContextMenu?.(rowOf(title), 3, 4);
            const delegate = shownMenus.at(-1);
            expect(delegate, "контекст-меню не показано").toBeDefined();
            return delegate!.getEntries?.() ?? [];
        },
    };
}

function entryByLabel(entries: MenuEntry[], label: string): MenuItemEntry {
    const entry = entries.find((candidate) => "label" in candidate && candidate.label === label);
    expect(entry, `пункт «${label}» не найден`).toBeDefined();
    return entry as MenuItemEntry;
}

/** Дать промисам действий строки дорезолвиться. */
function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe("KeybindingsEditorPane — контракт вкладки", () => {
    it("read-only вкладка с фиксированной идентичностью", () => {
        const h = makeHarness();

        expect(h.pane.uri.toString()).toBe(keybindingsEditorUri().toString());
        expect(h.pane.uri.scheme).toBe(KEYBINDINGS_EDITOR_SCHEME);
        expect(h.pane.label).toBe("Keyboard Shortcuts");
        expect(h.pane.readOnly).toBe(true);
        expect(h.pane.isModified).toBe(false);
        expect(h.pane.getSelectedTexts()).toEqual([]);
    });

    it("onDidChangeState отдаёт отписываемую заглушку", () => {
        const h = makeHarness();

        expect(() => {
            h.pane.onDidChangeState().dispose();
        }).not.toThrow();
    });

    it("focusEditor ставит фокус в строку поиска", () => {
        const h = makeHarness();
        const input = h.pane.view.querySelectorAll("InputElement")[0] as InputElement;
        const focusSpy = vi.spyOn(input, "focus").mockImplementation(() => {});

        h.pane.focusEditor();

        expect(focusSpy).toHaveBeenCalledOnce();
    });
});

describe("KeybindingsEditorPane — кадр", () => {
    it("первый кадр полон: шапка колонок и строки биндингов", () => {
        const h = makeHarness();

        const screen = h.render();

        expect(screen).toContain("Command");
        expect(screen).toContain("Keybinding");
        expect(screen).toContain("Save File");
        expect(screen).toContain("Ctrl+S");
        expect(screen).toContain("Show Hover");
        expect(screen).toContain("Extension");
        // Команда без биндинга — тоже строка, с тире вместо клавиши.
        expect(screen).toContain("Never Bound");
    });

    it("setFilter фильтрует список (путь «Show Conflicts»)", () => {
        const h = makeHarness();
        h.render();

        h.pane.setFilter("hover");

        const screen = h.render();
        expect(screen).toContain("Show Hover");
        expect(screen).not.toContain("Save File");
    });

    it("пустой результат фильтра показывает заглушку", () => {
        const h = makeHarness();
        h.render();

        h.pane.setFilter("zzzzzz");

        expect(h.render()).toContain("No keybindings found");
    });

    it("набор до первой раскладки не падает: строки соберёт первый кадр", () => {
        const h = makeHarness();

        h.pane.setFilter("hover");

        expect(h.render()).toContain("Show Hover");
    });

    it("смена ширины пересобирает колонки под новую ширину", () => {
        const h = makeHarness();
        const headerLine = (screen: string): string => screen.split("\n").find((line) => line.includes("Keybinding"))!;
        const wide = renderElement(h.pane.view, 100, 12, { themeVars: true }).screenToString();
        const narrow = renderElement(h.pane.view, 60, 12, { themeVars: true }).screenToString();

        expect(headerLine(wide).indexOf("Source")).toBeGreaterThan(headerLine(narrow).indexOf("Source"));
    });

    it("событие сервиса перечитывает реестр — новая запись появляется в кадре", () => {
        const h = makeHarness();
        h.render();

        h.registry.register(parseChord("f6"), "save", undefined, "user");
        h.service.emit();

        expect(h.render()).toContain("F6");
    });
});

describe("KeybindingsEditorPane — действия строки", () => {
    it("Enter по строке пишет новую комбинацию через рекордер, previous — запись строки", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = parseChord("f6");

        h.activateRowOf("Save File");
        await settle();

        expect(h.recorder.recordedTitles).toEqual(["Save File"]);
        expect(h.service.defines).toHaveLength(1);
        const call = h.service.defines[0];
        expect(call.commandId).toBe("save");
        expect(chordsEqual(call.chord, parseChord("f6"))).toBe(true);
        expect(call.previous?.source).toBe("default");
        expect(chordsEqual(call.previous!.chord, parseChord("ctrl+s"))).toBe(true);
    });

    it("Enter по строке без биндинга — добавление (previous отсутствует)", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = parseChord("f7");

        h.activateRowOf("Never Bound");
        await settle();

        expect(h.service.defines).toHaveLength(1);
        expect(h.service.defines[0].commandId).toBe("unbound");
        expect(h.service.defines[0].previous).toBeUndefined();
    });

    it("отмена рекордера мутаций не делает — и для Change, и для Add", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = null;

        h.activateRowOf("Save File");
        entryByLabel(h.menuOf("Save File"), "Add Keybinding").onSelect?.();
        await settle();

        expect(h.service.defines).toEqual([]);
    });

    it("контекст-меню: Add добавляет без previous, Remove снимает запись строки", async () => {
        const h = makeHarness();
        h.render();

        h.recorder.nextChord = parseChord("f8");
        entryByLabel(h.menuOf("Show Hover"), "Add Keybinding").onSelect?.();
        await settle();
        expect(h.service.defines).toHaveLength(1);
        expect(h.service.defines[0].previous).toBeUndefined();

        entryByLabel(h.menuOf("Show Hover"), "Remove Keybinding").onSelect?.();
        await settle();
        expect(h.service.removed).toHaveLength(1);
        expect(h.service.removed[0].commandId).toBe("hover");
        expect(h.service.removed[0].source).toBe("extension");
    });

    it("Reset показывается только при пользовательских правках и вызывает сервис", async () => {
        const h = makeHarness();
        h.render();

        const noReset = h.menuOf("Save File").filter((entry) => "label" in entry && entry.label === "Reset Keybinding");
        expect(noReset).toEqual([]);

        h.service.userModified.add("save");
        entryByLabel(h.menuOf("Save File"), "Reset Keybinding").onSelect?.();
        await settle();

        expect(h.service.resets).toEqual(["save"]);
    });

    it("у строки без биндинга нет Remove", () => {
        const h = makeHarness();
        h.render();

        const entries = h.menuOf("Never Bound").filter((entry) => "label" in entry && entry.label === "Remove Keybinding");
        expect(entries).toEqual([]);
    });

    it("Copy Command ID кладёт id в буфер", () => {
        const h = makeHarness();
        h.render();

        entryByLabel(h.menuOf("Show Hover"), "Copy Command ID").onSelect?.();

        expect(h.copied).toEqual(["hover"]);
    });

    it("ошибка мутации показывается строкой и уходит после успешной", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = parseChord("f6");
        h.service.result = { ok: false, error: "disk full" };

        h.activateRowOf("Save File");
        await settle();
        expect(h.render()).toContain("Failed to update keybindings.json: disk full");

        h.service.result = { ok: true };
        h.activateRowOf("Save File");
        await settle();
        h.service.emit();
        expect(h.render()).not.toContain("disk full");
    });

    it("Change Keybinding из меню — тот же путь, что Enter", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = parseChord("f9");

        entryByLabel(h.menuOf("Save File"), "Change Keybinding").onSelect?.();
        await settle();

        expect(h.service.defines).toHaveLength(1);
        expect(h.service.defines[0].previous?.source).toBe("default");
    });

    it("делегат меню несёт владельца и якорь у курсора", () => {
        const h = makeHarness();
        h.render();

        h.menuOf("Save File");
        const delegate = h.shownMenus.at(-1)!;

        expect(delegate.getOwner()).toBe(h.pane.view);
        expect(delegate.getAnchor()).toEqual({ screenX: 3, screenY: 4 });
    });

    it("шапка и заглушки не активируются и меню не несут", () => {
        const h = makeHarness();
        h.render();
        const list = h.pane.view.querySelector("#keybindingsList")!;
        const header = h.pane.view.querySelector("#kbHeader")!;

        (list as unknown as { onActivate: ((el: unknown) => void) | null }).onActivate?.(header);
        (
            list as unknown as { onContextMenu: ((el: unknown, x: number, y: number) => void) | null }
        ).onContextMenu?.(header, 1, 1);

        expect(h.recorder.recordedTitles).toEqual([]);
        expect(h.service.defines).toEqual([]);
        expect(h.shownMenus).toEqual([]);
    });
});
