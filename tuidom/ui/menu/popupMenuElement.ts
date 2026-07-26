import { BoxConstraints, Offset, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";
import type { OverlaySessionHandle } from "../contextview/overlayLayer.ts";
import { VStackElement } from "../layout/vStackElement.ts";

import type { IMenuStyles, PopupMenuItemConfig } from "./popupMenuItemElement.tsx";
import { PopupMenuItemElement, PopupMenuSeparatorElement, unthemedMenuStyles } from "./popupMenuItemElement.tsx";

export interface MenuItemEntry {
    type?: "item";
    label: string;
    shortcut?: string;
    icon?: string;
    onSelect?: () => void;
}

export interface MenuSeparatorEntry {
    type: "separator";
}

/**
 * Вложенное подменю: строка с индикатором `›`, открывающая дочерний попап.
 * `entries` может быть ленивым — резолвится в момент открытия подменю.
 */
export interface MenuSubmenuEntry {
    type: "submenu";
    label: string;
    icon?: string;
    entries: MenuEntry[] | (() => MenuEntry[]);
}

export type MenuEntry = MenuItemEntry | MenuSeparatorEntry | MenuSubmenuEntry;

function isSeparator(entry: MenuEntry): entry is MenuSeparatorEntry {
    return entry.type === "separator";
}

function isSubmenu(entry: MenuEntry): entry is MenuSubmenuEntry {
    return entry.type === "submenu";
}

/** Индикатор строки-подменю (рисуется в колонке шортката). */
const SUBMENU_INDICATOR = "›";

export class PopupMenuElement extends TUIElement {
    public readonly entries: MenuEntry[];
    public selectedIndex: number;
    public onClose?: () => void;

    private selectableIndices: number[];
    private vstack: VStackElement;
    private itemElements: PopupMenuItemElement[] = [];
    private separatorElements: PopupMenuSeparatorElement[] = [];
    private styles: IMenuStyles = unthemedMenuStyles;
    /** Открытое дочернее подменю (сессия — в том же overlay-слое). */
    private child: { menu: PopupMenuElement; session: OverlaySessionHandle } | null = null;
    private childEntryIndex = -1;
    /** Родитель в цепочке подменю; у корневого меню — null. */
    private parentMenu: PopupMenuElement | null = null;

    public constructor(entries: MenuEntry[]) {
        super();
        this.entries = entries;
        this.selectableIndices = entries.map((e, i) => (isSeparator(e) ? -1 : i)).filter((i) => i >= 0);
        this.selectedIndex = this.selectableIndices.length > 0 ? this.selectableIndices[0] : -1;

        const config = this.computeConfig();
        this.vstack = new VStackElement();

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const entryIndex = i;
            if (isSeparator(entry)) {
                const separator = new PopupMenuSeparatorElement(this.styles);
                this.separatorElements.push(separator);
                this.vstack.addChild(separator, { width: "stretch", height: 1 });
            } else if (isSubmenu(entry)) {
                const item = new PopupMenuItemElement(entry.label, config, SUBMENU_INDICATOR, entry.icon, this.styles);
                item.onSelect = () => {
                    this.openSubmenu(entryIndex);
                };
                item.onHover = () => {
                    this.selectByEntryIndex(entryIndex);
                };
                this.itemElements.push(item);
                this.vstack.addChild(item, { width: "stretch", height: 1 });
            } else {
                const item = new PopupMenuItemElement(entry.label, config, entry.shortcut, entry.icon, this.styles);
                item.onSelect = entry.onSelect;
                item.onHover = () => {
                    this.selectByEntryIndex(entryIndex);
                };
                this.itemElements.push(item);
                this.vstack.addChild(item, { width: "stretch", height: 1 });
            }
        }

        this.vstack.setParent(this);
        this.updateItemSelectedStates();
    }

    /** Раздаёт стили меню (свои + всем пунктам и сепараторам). */
    /** Observable state: item labels (separators as null) and the selected index. */
    public override inspectState(): Record<string, unknown> {
        return {
            selectedIndex: this.selectedIndex,
            items: this.entries.map((e) => (isSeparator(e) ? null : e.label)),
        };
    }

    public setStyles(styles: IMenuStyles): void {
        this.styles = styles;
        for (const item of this.itemElements) {
            item.setStyles(styles);
        }
        for (const separator of this.separatorElements) {
            separator.setStyles(styles);
        }
        this.markDirty();
    }

    public override getChildren(): readonly TUIElement[] {
        return [this.vstack];
    }

    public override getMinIntrinsicWidth(_height: number): number {
        return this.getIntrinsicSize().width;
    }

    public override getMaxIntrinsicWidth(_height: number): number {
        return this.getIntrinsicSize().width;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.getIntrinsicSize().height;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.getIntrinsicSize().height;
    }

    public getIntrinsicSize(): Size {
        const innerWidth = this.vstack.getMaxIntrinsicWidth(this.entries.length);
        const totalWidth = 2 + innerWidth; // borders left + right
        const totalHeight = this.entries.length + 2; // border top + entries + border bottom
        return new Size(totalWidth, totalHeight);
    }

    public performLayout(constraints: BoxConstraints): Size {
        const intrinsic = this.getIntrinsicSize();
        const resultSize = constraints.constrain(intrinsic);
        super.performLayout(BoxConstraints.tight(resultSize));

        const innerSize = new Size(resultSize.width - 2, resultSize.height - 2);
        this.vstack.localPosition = new Offset(1, 1);
        this.vstack.globalPosition = new Point(this.globalPosition.x + 1, this.globalPosition.y + 1);
        this.vstack.performLayout(BoxConstraints.tight(innerSize));

        return resultSize;
    }

    public render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        const borderFg = this.styles.borderFg;
        const bg = this.styles.bg;

        // Frame with T-connectors on separator rows (├───┤).
        const children = this.vstack.getChildren();
        const separators: number[] = [];
        for (let i = 0; i < children.length; i++) {
            if (children[i] instanceof PopupMenuSeparatorElement) separators.push(1 + i);
        }
        context.drawBox(0, 0, w, h, { fg: borderFg, bg, separators });

        // Render VStack content
        const vstackOffset = new Offset(this.vstack.localPosition.dx, this.vstack.localPosition.dy);
        const vstackClip = new Rect(this.vstack.globalPosition, this.vstack.layoutSize);
        this.vstack.render(context.withOffset(vstackOffset).withClip(vstackClip));
    }

    private computeConfig(): PopupMenuItemConfig {
        let hasIcon = false;
        let hasShortcuts = false;
        for (const entry of this.entries) {
            if (isSeparator(entry)) continue;
            if (entry.icon) hasIcon = true;
            // Индикатор подменю живёт в колонке шортката.
            if (isSubmenu(entry) || entry.shortcut) hasShortcuts = true;
        }
        return { hasIconColumn: hasIcon, hasShortcuts };
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "keydown") {
            this.handleMenuKey((event as TUIKeyboardEvent).key);
        }
    }

    /**
     * Клавиатура цепочки меню: фокус остаётся на корне, клавиши роутятся в
     * глубочайшее открытое подменю. ArrowLeft/Escape закрывают один уровень
     * (Escape без подменю — всё меню), ArrowRight/Enter открывают подменю.
     */
    private handleMenuKey(key: string): void {
        if (this.child) {
            // ArrowLeft закрывает ГЛУБОЧАЙШИЙ уровень — его родитель ближе всех.
            if (key === "ArrowLeft" && !this.child.menu.hasOpenSubmenu()) {
                this.closeChild();
                return;
            }
            this.child.menu.handleMenuKey(key);
            return;
        }
        if (key === "ArrowUp") {
            this.moveSelection(-1);
        } else if (key === "ArrowDown") {
            this.moveSelection(1);
        } else if (key === "Enter") {
            this.activateSelected();
        } else if (key === "ArrowRight") {
            if (this.selectedIndex >= 0 && isSubmenu(this.entries[this.selectedIndex])) {
                this.openSubmenu(this.selectedIndex);
            }
        } else if (key === "Escape") {
            this.onClose?.();
        }
    }

    /** Есть ли открытое подменю (на любом уровне достаточно первого). */
    public hasOpenSubmenu(): boolean {
        return this.child !== null;
    }

    /** target внутри цепочки подменю этого меню (для close-on-outside владельца). */
    public ownsElement(target: TUIElement): boolean {
        let current: TUIElement | null = target;
        while (current !== null) {
            if (current === this) return true;
            current = current.getParent();
        }
        return this.child !== null && this.child.menu.ownsElement(target);
    }

    /** Каскадно закрывает всю цепочку открытых подменю. */
    public closeSubmenus(): void {
        this.closeChild();
    }

    private closeChild(): void {
        if (!this.child) return;
        const child = this.child;
        this.child = null;
        this.childEntryIndex = -1;
        child.session.close();
    }

    private openSubmenu(entryIndex: number): void {
        const entry = this.entries[entryIndex];
        /* v8 ignore next -- defensive: вызывается только для submenu-строк */
        if (!isSubmenu(entry)) return;
        const layer = this.getOverlayLayer();
        if (!layer) return;
        if (this.childEntryIndex === entryIndex && this.child) return; // уже открыто
        this.closeChild();

        const resolved = typeof entry.entries === "function" ? entry.entries() : entry.entries;
        if (resolved.length === 0) return;

        // Выбор листа в подменю закрывает всю цепочку ДО действия (как у корня).
        const wrapped: MenuEntry[] = resolved.map((e) => {
            if (e.type === "separator" || e.type === "submenu") return e;
            const original = e.onSelect;
            return {
                ...e,
                onSelect: () => {
                    this.closeAll();
                    original?.();
                },
            };
        });

        const child = new PopupMenuElement(wrapped);
        child.setStyles(this.styles);
        child.parentMenu = this;
        child.onClose = () => {
            this.closeChild();
        };

        // Якорь — строка-владелец: вплотную справа от родителя, первой строкой
        // на уровне строки (preferBelow: false); флип у краёв — computeAnchorPosition.
        const rowGlobalY = this.globalPosition.y + 1 + entryIndex;
        const session = layer.openPopupSession(
            child,
            {
                screenX: this.globalPosition.x,
                screenY: rowGlobalY,
                offsetX: this.layoutSize.width,
                preferBelow: false,
            },
            {
                visible: true,
                focusOnOpen: false,
                restoreFocus: false,
                closeOnEscape: false,
                pointerPolicy: "passthrough",
                disposeOnClose: true,
                onClose: () => {
                    child.closeSubmenus();
                    if (this.child?.menu === child) {
                        this.child = null;
                        this.childEntryIndex = -1;
                    }
                },
            },
        );
        this.child = { menu: child, session };
        this.childEntryIndex = entryIndex;
    }

    /** Закрыть всю цепочку: вверх до корня; корень закрывает свою сессию. */
    private closeAll(): void {
        if (this.parentMenu) {
            this.parentMenu.closeAll();
            return;
        }
        this.closeChild();
        this.onClose?.();
    }

    private updateItemSelectedStates(): void {
        let itemIndex = 0;
        for (let i = 0; i < this.entries.length; i++) {
            if (!isSeparator(this.entries[i])) {
                this.itemElements[itemIndex].selected = i === this.selectedIndex;
                itemIndex++;
            }
        }
    }

    /**
     * Moves the selection onto the item at the given entry index. Only called
     * from item hover callbacks, so `index` is always a selectable entry.
     */
    private selectByEntryIndex(index: number): void {
        // Ховер по другой строке родителя закрывает открытое подменю.
        if (this.child && index !== this.childEntryIndex) {
            this.closeChild();
        }
        if (index === this.selectedIndex) return;
        this.selectedIndex = index;
        this.updateItemSelectedStates();
    }

    private moveSelection(direction: number): void {
        if (this.selectableIndices.length === 0) return;
        const currentPos = this.selectableIndices.indexOf(this.selectedIndex);
        let nextPos = currentPos + direction;
        if (nextPos < 0) nextPos = this.selectableIndices.length - 1;
        if (nextPos >= this.selectableIndices.length) nextPos = 0;
        this.selectedIndex = this.selectableIndices[nextPos];
        this.updateItemSelectedStates();
    }

    private activateSelected(): void {
        if (this.selectedIndex < 0) return;
        const entry = this.entries[this.selectedIndex];
        if (isSubmenu(entry)) {
            this.openSubmenu(this.selectedIndex);
        } else if (!isSeparator(entry) && entry.onSelect) {
            entry.onSelect();
        }
    }
}
