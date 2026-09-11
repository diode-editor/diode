import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ContextMenuService } from "../../../../platform/contextview/browser/contextMenuService.ts";
import type {
    IKeybindingEntrySnapshot,
    KeybindingChord,
    KeybindingRegistry,
} from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { FilteredListControl } from "../../../browser/parts/views/filteredListControl.ts";
import type { IKeybindingsEditorService } from "../../../services/keybinding/common/iKeybindingsEditorService.ts";

import type { IFilteredKeybindingItem, IKeybindingItem } from "../common/keybindingsEditorModel.ts";
import { buildKeybindingItems, filterKeybindingItems } from "../common/keybindingsEditorModel.ts";

import type { IKeybindingRowStyles } from "./keybindingRows.ts";
import { buildKeybindingHeaderRow, buildKeybindingRow, describeKeybindingRow } from "./keybindingRows.ts";

/**
 * Схема ресурса вкладки Keyboard Shortcuts. Настоящего файла за ней нет — это
 * идентичность вкладки: `EditorService.openPane` по ней переключается на уже
 * открытую вкладку вместо второй такой же (приём `extension:`).
 */
export const KEYBINDINGS_EDITOR_SCHEME = "keybindings";

/** Ресурс вкладки; вкладка одна на окно, поэтому путь фиксированный. */
export function keybindingsEditorUri(): Uri {
    return Uri.from({ scheme: KEYBINDINGS_EDITOR_SCHEME, path: "global" });
}

/**
 * Минимальный срез полосы редакторов: открыть вкладку шорткатов.
 * `EditorService` соответствует ему структурно — связывание делает DI-модуль
 * (как `ExtensionsEditorTargetDIToken` у магазина).
 */
export interface IKeybindingsEditorTarget {
    openPane(pane: IEditorPane): void;
}

export const KeybindingsEditorTargetDIToken = token<IKeybindingsEditorTarget>("KeybindingsEditorTarget");

/** Узкий срез рекордера: показать оверлей и дождаться чорда (`null` — отмена). */
export interface IKeybindingRecorder {
    record(commandTitle: string): Promise<KeybindingChord | null>;
}

const HEADER_ROW_ID = "kbHeader";
const EMPTY_ROW_ID = "kbEmpty";
const ERROR_ROW_ID = "kbError";

const ROW_STYLES: IKeybindingRowStyles = {
    dimFg: "descriptionForeground",
    highlightFg: "list.highlightForeground",
};

/**
 * Колонки считаются под ширину, а ширина известна только в раскладке — приём
 * `ExtensionPageElement`: пересборка строк на СМЕНУ ширины прямо в
 * `performLayout`, до раскладки ребёнка, чтобы первый кадр был полон.
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

/**
 * Вкладка Keyboard Shortcuts: таблица всех команд с биндингами (`Command |
 * Keybinding | When | Source`), строкой поиска и редактированием — Enter или
 * двойной клик по строке открывают рекордер, контекст-меню несёт
 * Change/Add/Remove/Reset/Copy. Мутации применяются мгновенно
 * ({@link IKeybindingsEditorService}); ошибка записи показывается строкой.
 * Read-only как вкладка (без текстовой проекции — `viewState` нет).
 */
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
    /** Строки как показаны: id строки → её запись. */
    private readonly rowItems = new Map<string, IKeybindingItem>();
    private items: IKeybindingItem[];
    /** Ширина, под которую посчитаны колонки; `null` — до первой раскладки. */
    private width: number | null = null;
    /** Ошибка последней мутации — строкой под шапкой до следующей успешной. */
    private operationError: string | null = null;

    public constructor(
        private readonly keybindings: KeybindingRegistry,
        private readonly commands: CommandRegistry,
        private readonly service: IKeybindingsEditorService,
        private readonly recorder: IKeybindingRecorder,
        private readonly contextMenu: ContextMenuService,
        private readonly clipboard: IClipboard,
    ) {
        super();
        this.items = this.readItems();
        this.control.onQueryChange = () => {
            this.rebuildRows();
        };
        this.control.onActivateRow = (rowId) => {
            const item = this.rowItems.get(rowId);
            if (item !== undefined) void this.changeKeybinding(item);
        };
        this.control.list.onContextMenu = (element, screenX, screenY) => {
            // Строки без id список не принимает — id здесь гарантирован.
            const item = this.rowItems.get(element.id!);
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
        // Метка и маркер правки вкладки неизменны — событию не с чего стрелять.
        return { dispose: () => {} };
    }

    public focusEditor(): void {
        this.control.focusInput();
    }

    /** Программный фильтр (пункт «Show Conflicts», тесты). */
    public setFilter(query: string): void {
        this.control.setQuery(query);
    }

    // ─── Действия строки ─────────────────────────────────────────────────────

    /** Enter/двойной клик: перезаписать биндинг строки (у строки без биндинга — добавить). */
    private async changeKeybinding(item: IKeybindingItem): Promise<void> {
        const chord = await this.recorder.record(item.title);
        if (chord === null) return;
        await this.runMutation(this.service.defineKeybinding(item.commandId, chord, this.snapshotOf(item)));
    }

    /** Дополнительный биндинг, не снимая существующий. */
    private async addKeybinding(item: IKeybindingItem): Promise<void> {
        const chord = await this.recorder.record(item.title);
        if (chord === null) return;
        await this.runMutation(this.service.defineKeybinding(item.commandId, chord));
    }

    private async runMutation(mutation: Promise<{ ok: true } | { ok: false; error: string }>): Promise<void> {
        const result = await mutation;
        // Успешная мутация перерисует список событием сервиса — ошибку
        // показываем сами (и сбрасываем прошлую при успехе).
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
        entries.push({
            label: "Copy Command ID",
            onSelect: () => {
                void this.clipboard.writeText(item.commandId);
            },
        });
        return entries;
    }

    /** Снапшот записи реестра, которой соответствует строка; `undefined` — строка без биндинга. */
    private snapshotOf(item: IKeybindingItem): IKeybindingEntrySnapshot | undefined {
        if (item.chord === null || item.source === null) return undefined;
        return { chord: item.chord, commandId: item.commandId, when: item.when, source: item.source };
    }

    // ─── Строки ──────────────────────────────────────────────────────────────

    private readItems(): IKeybindingItem[] {
        return buildKeybindingItems(this.keybindings.listBindings(), this.commands.listCommands());
    }

    private rebuildRows(): void {
        // До первой раскладки ширины нет — и строк тоже: колонки без ширины
        // посчитать не из чего.
        if (this.width === null) return;
        const filtered = filterKeybindingItems(this.items, this.control.getQuery());

        this.control.list.clear();
        this.rowItems.clear();
        this.control.list.appendRow(buildKeybindingHeaderRow(HEADER_ROW_ID, this.width, ROW_STYLES.dimFg));
        if (this.operationError !== null) {
            const row = new TextLabelElement(`Failed to update keybindings.json: ${this.operationError}`);
            row.id = ERROR_ROW_ID;
            row.setColors("editorWarning.foreground", INHERITED_BG);
            this.control.list.appendRow(row);
        }
        filtered.forEach((entry, index) => {
            this.appendItemRow(entry, index);
        });
        if (filtered.length === 0) this.control.showPlaceholderRow(EMPTY_ROW_ID, "No keybindings found");
    }

    private appendItemRow(entry: IFilteredKeybindingItem, index: number): void {
        // width проверен в rebuildRows — единственном вызывающем.
        const layout = describeKeybindingRow(entry, this.width!);
        const rowId = `kb-${String(index)}`;
        this.control.list.appendRow(buildKeybindingRow(rowId, layout, ROW_STYLES), { label: entry.item.title });
        this.rowItems.set(rowId, entry.item);
    }
}
