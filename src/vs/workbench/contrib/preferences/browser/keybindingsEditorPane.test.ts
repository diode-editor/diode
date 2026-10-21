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
    KeybindingLabelStyle,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import {
    chordsEqual,
    KeybindingRegistry,
    parseChord,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type {
    IKeybindingMutationResult,
    IKeybindingsEditorService,
} from "../../../services/keybinding/common/iKeybindingsEditorService.ts";

import { KEYBINDINGS_EDITOR_SCHEME, KeybindingsEditorPane, keybindingsEditorUri } from "./keybindingsEditorPane.ts";

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
    /** null means cancel. */
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
    activateRowOf(title: string): void;
    menuOf(title: string): MenuEntry[];
}

function makeHarness(labelStyle?: () => KeybindingLabelStyle): IHarness {
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

    const pane = new KeybindingsEditorPane(
        registry,
        commands,
        service,
        recorder,
        contextMenu,
        clipboard,
        labelStyle ?? (() => "pc"),
    );

    const rowOf = (title: string) => {
        const rows = pane.view.querySelectorAll("TextLabelElement");
        const row = rows.find((candidate) =>
            (candidate as unknown as { getText(): string }).getText().startsWith(title),
        );
        expect(row, `row "${title}" not found`).toBeDefined();
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
            expect(delegate, "context menu not shown").toBeDefined();
            return delegate!.getEntries?.() ?? [];
        },
    };
}

function entryByLabel(entries: MenuEntry[], label: string): MenuItemEntry {
    const entry = entries.find((candidate) => "label" in candidate && candidate.label === label);
    expect(entry, `item "${label}" not found`).toBeDefined();
    return entry as MenuItemEntry;
}

function settle(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

describe("KeybindingsEditorPane — tab contract", () => {
    it("read-only tab with a fixed identity", () => {
        const h = makeHarness();

        expect(h.pane.uri.toString()).toBe(keybindingsEditorUri().toString());
        expect(h.pane.uri.scheme).toBe(KEYBINDINGS_EDITOR_SCHEME);
        expect(keybindingsEditorUri().path).toBe("global");
        expect(h.pane.label).toBe("Keyboard Shortcuts");
        expect(h.pane.readOnly).toBe(true);
        expect(h.pane.isModified).toBe(false);
        expect(h.pane.getSelectedTexts()).toEqual([]);
    });

    it("carries its ids: root, control container and list", () => {
        const h = makeHarness();

        expect(h.pane.view.id).toBe("keybindingsEditor");
        expect(h.pane.view.querySelector("#keybindingsEditorView")).not.toBeNull();
        expect(h.pane.view.querySelector("#keybindingsList")).not.toBeNull();
    });

    it("onDidChangeState returns a disposable stub", () => {
        const h = makeHarness();

        expect(() => {
            h.pane.onDidChangeState().dispose();
        }).not.toThrow();
    });

    it("focusEditor focuses the search box", () => {
        const h = makeHarness();
        const input = h.pane.view.querySelectorAll("InputElement")[0] as InputElement;
        const focusSpy = vi.spyOn(input, "focus").mockImplementation(() => {});

        h.pane.focusEditor();

        expect(focusSpy).toHaveBeenCalledOnce();
    });
});

describe("KeybindingsEditorPane — frame", () => {
    it("on mac combinations use glyphs (the style is taken from the pane on every row rebuild)", () => {
        const h = makeHarness(() => "mac");
        const screen = h.render();

        expect(screen).toContain("⌃S"); // ctrl+s on mac is Control
        expect(screen).toContain("⌃K ⌃U");
        expect(screen).not.toContain("Ctrl+S");
    });

    it("the first frame is complete: column header and keybinding rows", () => {
        const h = makeHarness();

        const screen = h.render();

        expect(screen).toContain("Command");
        expect(screen).toContain("Keybinding");
        expect(screen).toContain("Save File");
        expect(screen).toContain("Ctrl+S");
        expect(screen).toContain("Show Hover");
        expect(screen).toContain("Extension");
        expect(screen).toContain("Never Bound");
        expect(screen).toContain("Type to search keybindings");
        expect(screen).not.toContain("Failed to update keybindings.json");
        expect(screen).not.toContain("No keybindings found");
    });

    it("setFilter filters the list (the 'Show Conflicts' path)", () => {
        const h = makeHarness();
        h.render();

        h.pane.setFilter("hover");

        const screen = h.render();
        expect(screen).toContain("Show Hover");
        expect(screen).not.toContain("Save File");
    });

    it("an empty filter result shows a placeholder", () => {
        const h = makeHarness();
        h.render();

        h.pane.setFilter("zzzzzz");

        expect(h.render()).toContain("No keybindings found");
    });

    it("typing before the first layout does not throw: the first frame builds the rows", () => {
        const h = makeHarness();

        h.pane.setFilter("hover");

        expect(h.render()).toContain("Show Hover");
    });

    it("rows are not built before the first layout — guarded by width", () => {
        const h = makeHarness();
        // setFilter triggers rebuildRows, but there was no layout yet (width null).
        h.pane.setFilter("hover");
        const list = h.pane.view.querySelector("#keybindingsList") as unknown as { rowCount: number };
        expect(list.rowCount).toBe(0);
        expect(h.render()).toContain("Show Hover");
    });

    it("a width change rebuilds the columns for the new width", () => {
        const h = makeHarness();
        const headerLine = (screen: string): string => screen.split("\n").find((line) => line.includes("Keybinding"))!;
        const wide = renderElement(h.pane.view, 100, 12, { themeVars: true }).screenToString();
        const narrow = renderElement(h.pane.view, 60, 12, { themeVars: true }).screenToString();

        expect(headerLine(wide).indexOf("Source")).toBeGreaterThan(headerLine(narrow).indexOf("Source"));
    });

    it("a service event re-reads the registry — the new entry appears in the frame", () => {
        const h = makeHarness();
        h.render();

        h.registry.register(parseChord("f6"), "save", undefined, "user");
        h.service.emit();

        expect(h.render()).toContain("F6");
    });
});

describe("KeybindingsEditorPane — row actions", () => {
    it("Enter on a row records a new combination via the recorder, previous is the row's entry", async () => {
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

    it("Enter on a row without a keybinding adds one (no previous)", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = parseChord("f7");

        h.activateRowOf("Never Bound");
        await settle();

        expect(h.service.defines).toHaveLength(1);
        expect(h.service.defines[0].commandId).toBe("unbound");
        expect(h.service.defines[0].previous).toBeUndefined();
    });

    it("cancelling the recorder makes no mutations — for both Change and Add", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = null;

        h.activateRowOf("Save File");
        entryByLabel(h.menuOf("Save File"), "Add Keybinding").onSelect?.();
        await settle();

        expect(h.service.defines).toEqual([]);
    });

    it("context menu: Add adds without previous, Remove removes the row's entry", async () => {
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

    it("Reset shows only with user edits and calls the service", async () => {
        const h = makeHarness();
        h.render();

        const noReset = h.menuOf("Save File").filter((entry) => "label" in entry && entry.label === "Reset Keybinding");
        expect(noReset).toEqual([]);

        h.service.userModified.add("save");
        entryByLabel(h.menuOf("Save File"), "Reset Keybinding").onSelect?.();
        await settle();

        expect(h.service.resets).toEqual(["save"]);
    });

    it("a row without a keybinding has no Remove or Show Conflicts", () => {
        const h = makeHarness();
        h.render();

        const labels = h.menuOf("Never Bound").map((entry) => ("label" in entry ? entry.label : "—"));
        expect(labels).not.toContain("Remove Keybinding");
        expect(labels).not.toContain("Show Conflicts");
    });

    it("Show Conflicts seeds the @conflicts filter with the row's combination", () => {
        const h = makeHarness();
        h.render();

        entryByLabel(h.menuOf("Save File"), "Show Conflicts").onSelect?.();

        const input = h.pane.view.querySelectorAll("InputElement")[0] as InputElement;
        expect(input.inputState.value).toBe("@conflicts ctrl+s");
    });

    it("conflicting rows reach the frame and are filtered by @conflicts", () => {
        const h = makeHarness();
        h.registry.register(parseChord("ctrl+s"), "hover", undefined, "user");
        h.service.emit();
        h.render();

        h.pane.setFilter("@conflicts");

        const screen = h.render();
        expect(screen).toContain("Save File");
        expect(screen).toContain("Show Hover");
        expect(screen).not.toContain("Never Bound");
    });

    it("Copy Command ID puts the id on the clipboard", () => {
        const h = makeHarness();
        h.render();

        entryByLabel(h.menuOf("Show Hover"), "Copy Command ID").onSelect?.();

        expect(h.copied).toEqual(["hover"]);
    });

    it("a mutation error shows as a line and goes away after a successful one", async () => {
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
        // A successful mutation does NOT rebuild the list by itself — the update comes
        // via the service event; until emit the error row is still there.
        expect(h.render()).toContain("disk full");
        h.service.emit();
        expect(h.render()).not.toContain("disk full");
    });

    it("Change Keybinding from the menu takes the same path as Enter", async () => {
        const h = makeHarness();
        h.render();
        h.recorder.nextChord = parseChord("f9");

        entryByLabel(h.menuOf("Save File"), "Change Keybinding").onSelect?.();
        await settle();

        expect(h.service.defines).toHaveLength(1);
        expect(h.service.defines[0].previous?.source).toBe("default");
    });

    it("the menu delegate carries the owner and an anchor at the cursor", () => {
        const h = makeHarness();
        h.render();

        h.menuOf("Save File");
        const delegate = h.shownMenus.at(-1)!;

        expect(delegate.getOwner()).toBe(h.pane.view);
        expect(delegate.getAnchor()).toEqual({ screenX: 3, screenY: 4 });
    });

    it("the menu carries a separator between edits and Copy Command ID", () => {
        const h = makeHarness();
        h.render();

        const menu = h.menuOf("Save File");

        const sepIndex = menu.findIndex((entry) => "type" in entry && entry.type === "separator");
        expect(sepIndex).toBeGreaterThanOrEqual(0);
        const copyIndex = menu.findIndex((entry) => "label" in entry && entry.label === "Copy Command ID");
        expect(copyIndex).toBeGreaterThan(sepIndex);
    });

    it("the header and placeholders do not activate and carry no menu", () => {
        const h = makeHarness();
        h.render();
        const list = h.pane.view.querySelector("#keybindingsList")!;
        const header = h.pane.view.querySelector("#kbHeader")!;

        (list as unknown as { onActivate: ((el: unknown) => void) | null }).onActivate?.(header);
        (list as unknown as { onContextMenu: ((el: unknown, x: number, y: number) => void) | null }).onContextMenu?.(
            header,
            1,
            1,
        );

        expect(h.recorder.recordedTitles).toEqual([]);
        expect(h.service.defines).toEqual([]);
        expect(h.shownMenus).toEqual([]);
    });
});
