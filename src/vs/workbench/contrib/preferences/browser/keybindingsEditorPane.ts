import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { listRowId } from "../../../../base/common/listRowId.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
    KeybindingLabelStyle,
    KeybindingRegistry,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { serializeChord } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { FilteredListControl } from "../../../browser/parts/views/filteredListControl.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IKeybindingsEditorService } from "../../../services/keybinding/common/iKeybindingsEditorService.ts";
import type { IFilteredKeybindingItem, IKeybindingItem } from "../common/keybindingsEditorModel.ts";
import { buildKeybindingItems, filterKeybindingItems } from "../common/keybindingsEditorModel.ts";

import type { IKeybindingRowStyles } from "./keybindingRows.ts";
import { buildKeybindingHeaderRow, buildKeybindingRow, describeKeybindingRow } from "./keybindingRows.ts";

/**
 * There is no file behind the scheme — it is the tab's identity: `EditorService.openPane` uses it to switch to the already
 * open tab instead of opening a second one (the `extension:` technique).
 */
export const KEYBINDINGS_EDITOR_SCHEME = "keybindings";

/** One tab per window — the path is fixed. */
export function keybindingsEditorUri(): Uri {
    return Uri.from({ scheme: KEYBINDINGS_EDITOR_SCHEME, path: "global" });
}

export interface IKeybindingsEditorTarget {
    openPane(pane: IEditorPane, options?: { focus?: boolean; group?: EditorGroup }): void;
}

export const KeybindingsEditorTargetDIToken = token<IKeybindingsEditorTarget>("KeybindingsEditorTarget");

/** `null` means cancel. */
export interface IKeybindingRecorder {
    record(commandTitle: string): Promise<KeybindingChord | null>;
}

const HEADER_ROW_ID = "kbHeader";
const EMPTY_ROW_ID = "kbEmpty";
const ERROR_ROW_ID = "kbError";

const ROW_STYLES: IKeybindingRowStyles = {
    dimFg: "descriptionForeground",
    highlightFg: "list.highlightForeground",
    conflictFg: "editorWarning.foreground",
};

/**
 * Width is known only during layout — the `ExtensionPageElement` technique: rows are rebuilt on a width CHANGE
 * right in `performLayout`, before the child's layout, so the first frame is complete.
 */
class KeybindingsEditorElement extends TUIElement {
    private lastWidth: number | null = null;

    public constructor(
        private readonly child: TUIElement,
        private readonly onWidthChange: (width: number) => void,
    ) {
        super();
        this.appendChild(child);
        this.id = "keybindingsEditor";
        // Stryker disable next-line ObjectLiteral: root colors are theme tokens; frame tests don't pin the background.
        this.style = { fg: "editor.foreground", bg: "editor.background" };
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        if (size.width !== this.lastWidth) {
            this.lastWidth = size.width;
            this.onWidthChange(size.width);
        }
        this.layoutChild(this.child, 0, 0, BoxConstraints.tight(size));
        return size;
    }
}

/** Mutations apply immediately, a write error shows as a row. Read-only as a tab: there is no text projection. */
export class KeybindingsEditorPane extends Disposable implements IEditorPane {
    public readonly uri = keybindingsEditorUri();
    public readonly label = "Keyboard Shortcuts";
    public readonly view: TUIElement;
    public readonly isModified = false;
    public readonly readOnly = true;

    private readonly control = new FilteredListControl({
        viewId: "keybindingsEditorView",
        listId: "keybindingsList",
        placeholder: "Type to search keybindings",
    });
    private readonly rowItems = new Map<string, IKeybindingItem>();
    private items: IKeybindingItem[];
    /** `null` until the first layout. */
    private width: number | null = null;
    /** Kept until the next successful mutation. */
    private operationError: string | null = null;

    public constructor(
        private readonly keybindings: KeybindingRegistry,
        private readonly commands: CommandRegistry,
        private readonly service: IKeybindingsEditorService,
        private readonly recorder: IKeybindingRecorder,
        private readonly contextMenu: ContextMenuService,
        private readonly clipboard: IClipboard,
        private readonly labelStyle: () => KeybindingLabelStyle,
    ) {
        super();
        this.items = this.readItems();
        this.control.onQueryChange = () => {
            this.rebuildRows();
        };
        this.control.onActivateRow = (rowId) => {
            const item = this.rowItems.get(rowId);
            // Stryker disable next-line ConditionalExpression: removing the guard calls changeKeybinding(undefined) → item.title throws from a fire-and-forget promise; an unhandled error from the listener crashes the runner instead of failing a test (a gap in emitter error localization, see docs/MUTATION.md → #275), not a gap in this line's tests.
            if (item !== undefined) void this.changeKeybinding(item);
        };
        this.control.list.onContextMenu = (element, screenX, screenY) => {
            const item = this.rowItems.get(listRowId(element));
            if (item === undefined) return;
            this.contextMenu.showContextMenu({
                getOwner: () => this.view,
                getAnchor: () => ({ screenX, screenY }),
                getEntries: () => this.menuEntriesFor(item),
            });
        };
        this.register(
            this.service.onDidChange(() => {
                this.items = this.readItems();
                this.rebuildRows();
            }),
        );
        this.view = new KeybindingsEditorElement(this.control.view, (width) => {
            this.width = width;
            this.rebuildRows();
        });
    }

    public getSelectedTexts(): string[] {
        return [];
    }

    public onDidChangeState(): IDisposable {
        // The tab's label and dirty marker never change — nothing for the event to fire on.
        return {
            dispose: () => {
                /* no-op */
            },
        };
    }

    public focusEditor(): void {
        this.control.focusInput();
    }

    public setFilter(query: string): void {
        this.control.setQuery(query);
    }

    /** On a row without a binding it adds one. */
    private async changeKeybinding(item: IKeybindingItem): Promise<void> {
        const chord = await this.recorder.record(item.title);
        if (chord === null) return;
        await this.runMutation(this.service.defineKeybinding(item.commandId, chord, this.snapshotOf(item)));
    }

    private async addKeybinding(item: IKeybindingItem): Promise<void> {
        const chord = await this.recorder.record(item.title);
        if (chord === null) return;
        await this.runMutation(this.service.defineKeybinding(item.commandId, chord));
    }

    private async runMutation(mutation: Promise<{ ok: true } | { ok: false; error: string }>): Promise<void> {
        const result = await mutation;
        // A successful mutation redraws the list via the service event — the error
        // we show ourselves (and clear the previous one on success).
        this.operationError = result.ok ? null : result.error;
        if (!result.ok) this.rebuildRows();
    }

    private menuEntriesFor(item: IKeybindingItem): MenuEntry[] {
        const entries: MenuEntry[] = [
            {
                label: "Change Keybinding",
                onSelect: () => {
                    void this.changeKeybinding(item);
                },
            },
            {
                label: "Add Keybinding",
                onSelect: () => {
                    void this.addKeybinding(item);
                },
            },
        ];
        const snapshot = this.snapshotOf(item);
        if (snapshot !== undefined) {
            entries.push({
                label: "Remove Keybinding",
                onSelect: () => {
                    void this.runMutation(this.service.removeKeybinding(snapshot));
                },
            });
        }
        if (this.service.hasUserModifications(item.commandId)) {
            entries.push({
                label: "Reset Keybinding",
                onSelect: () => {
                    void this.runMutation(this.service.resetKeybinding(item.commandId));
                },
            });
        }
        entries.push({ type: "separator" });
        if (item.chord !== null) {
            const chord = item.chord;
            entries.push({
                label: "Show Conflicts",
                onSelect: () => {
                    this.setFilter(`@conflicts ${serializeChord(chord)}`);
                },
            });
        }
        entries.push({
            label: "Copy Command ID",
            onSelect: () => {
                void this.clipboard.writeText(item.commandId);
            },
        });
        return entries;
    }

    /** `undefined` for a row without a binding. */
    private snapshotOf(item: IKeybindingItem): IKeybindingEntrySnapshot | undefined {
        // Under the chord⇔source invariant the second half is unreachable — it only narrows the type of `source`.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: redundant double check under the chord⇔source invariant — internal mutations of the condition produce no observable model row.
        if (item.chord === null || item.source === null) return undefined;
        return { chord: item.chord, commandId: item.commandId, when: item.when, source: item.source };
    }

    private readItems(): IKeybindingItem[] {
        return buildKeybindingItems(this.keybindings.listBindings(), this.commands.listCommands());
    }

    private rebuildRows(): void {
        if (this.width === null) return;
        const filtered = filterKeybindingItems(this.items, this.control.getQuery(), this.labelStyle());

        this.control.list.clear();
        // Stryker disable next-line CallExpression: the list is cleared on the line above, and row ids are sequential (kb-0…), so lookup always hits the current entry; clearing the map again is defensive and unobservable.
        this.rowItems.clear();
        this.control.list.appendRow(buildKeybindingHeaderRow(HEADER_ROW_ID, this.width, ROW_STYLES.dimFg));
        if (this.operationError !== null) {
            const row = new TextLabelElement(`Failed to update keybindings.json: ${this.operationError}`);
            row.id = ERROR_ROW_ID;
            row.setColors("editorWarning.foreground", INHERITED_BG);
            this.control.list.appendRow(row);
        }
        const width = this.width;
        filtered.forEach((entry, index) => {
            this.appendItemRow(entry, index, width);
        });
        if (filtered.length === 0) this.control.showPlaceholderRow(EMPTY_ROW_ID, "No keybindings found");
    }

    /** `width` comes from rebuildRows — the only caller, where it is already checked. */
    private appendItemRow(entry: IFilteredKeybindingItem, index: number, width: number): void {
        const layout = describeKeybindingRow(entry, width, this.labelStyle());
        const rowId = `kb-${String(index)}`;
        // Stryker disable next-line ObjectLiteral: label is a hint for the list's typeahead, which is off in this tab; it doesn't affect behavior.
        this.control.list.appendRow(buildKeybindingRow(rowId, layout, ROW_STYLES), { label: entry.item.title });
        this.rowItems.set(rowId, entry.item);
    }
}
