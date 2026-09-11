import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";
import { TUIElement } from "@tuidom/core/dom/tuiElement";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import { FilteredListControl } from "../../../browser/parts/views/filteredListControl.ts";

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

const HEADER_ROW_ID = "kbHeader";
const EMPTY_ROW_ID = "kbEmpty";

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
 * Keybinding | When | Source`) и строкой поиска. Read-only, без текстовой
 * проекции — `viewState` нет, команды курсора её не видят.
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
    /** Строки как показаны: id строки → её запись (действия строки — коммит рекордера). */
    private readonly rowItems = new Map<string, IKeybindingItem>();
    private items: IKeybindingItem[];
    /** Ширина, под которую посчитаны колонки; `null` — до первой раскладки. */
    private width: number | null = null;

    public constructor(
        private readonly keybindings: KeybindingRegistry,
        private readonly commands: CommandRegistry,
    ) {
        super();
        this.items = this.readItems();
        this.control.onQueryChange = () => {
            this.rebuildRows();
        };
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
