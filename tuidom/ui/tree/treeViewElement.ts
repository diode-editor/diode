import { packRgb } from "../../common/colorUtils.ts";
import { DisplayLine } from "../../common/displayLine.ts";
import { Point } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import type { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import type { TUIContextMenuEvent, TUIMouseEvent } from "../../dom/events/tuiMouseEvent.ts";
import type { RenderContext } from "../../dom/tuiElement.ts";
import { ScrollableElement, type ScrollViewportInfo } from "../scrollbar/scrollableElement.ts";

import type { ITreeDataProvider, ITreeItem } from "./iTreeDataProvider.ts";

const INDENT_SIZE = 2;
// Окно, в течение которого напечатанные символы складываются в одну последовательность
// быстрого поиска; после паузы буфер сбрасывается (как в VS Code / файловых менеджерах).
const TYPEAHEAD_TIMEOUT_MS = 800;
const ICON_EXPANDED = "\uF107"; //  nf-fa-angle_down — chevron, как в nvim-tree/NvChad
const ICON_COLLAPSED = "\uF105"; //  nf-fa-angle_right
const SYMLINK_BADGE = "\u21B5"; // enter-like arrow marking a symlink, pinned to the right edge

export interface ITreeViewStyles {
    readonly activeSelectionBg: number;
    readonly activeSelectionFg: number;
    readonly inactiveSelectionBg: number;
    readonly inactiveSelectionFg: number;
    /** `undefined` \u043E\u0442\u043A\u043B\u044E\u0447\u0430\u0435\u0442 hover-\u043F\u043E\u0434\u0441\u0432\u0435\u0442\u043A\u0443. */
    readonly hoverBg: number | undefined;
    /** `undefined` \u2014 hovered-\u0441\u0442\u0440\u043E\u043A\u0430 \u043E\u0441\u0442\u0430\u0432\u043B\u044F\u0435\u0442 \u043E\u0431\u044B\u0447\u043D\u044B\u0439 fg. */
    readonly hoverFg: number | undefined;
    /** `undefined` \u043E\u0442\u043A\u043B\u044E\u0447\u0430\u0435\u0442 \u043F\u0440\u0438\u0433\u043B\u0443\u0448\u0435\u043D\u0438\u0435 \u00AB\u0432\u044B\u0440\u0435\u0437\u0430\u043D\u043D\u044B\u0445\u00BB \u0441\u0442\u0440\u043E\u043A. */
    readonly cutFg: number | undefined;
    readonly symlinkFg: number;
}

// Defaults preserve the historical look; controllers override them via setStyles.
export const unthemedTreeViewStyles: ITreeViewStyles = {
    activeSelectionBg: packRgb(4, 57, 94),
    activeSelectionFg: packRgb(255, 255, 255),
    inactiveSelectionBg: packRgb(55, 55, 61),
    inactiveSelectionFg: packRgb(204, 204, 204),
    hoverBg: undefined,
    hoverFg: undefined,
    cutFg: undefined,
    symlinkFg: packRgb(128, 128, 128),
};

interface FlatTreeNode<T> {
    element: T;
    depth: number;
    item: ITreeItem;
    parentKey: string | null;
}

export class TreeViewElement<T> extends ScrollableElement {
    private provider: ITreeDataProvider<T>;
    private expandedKeys = new Set<string>();
    private childrenCache = new Map<string, T[]>();
    private flatNodes: FlatTreeNode<T>[] = [];
    private selectedIndex = 0;
    private selectionAnchor = 0;
    private hoveredIndex: number | null = null;
    private selectedKeys = new Set<string>();
    private cutKeys = new Set<string>();
    private maxRowWidth = 0;
    /**
     * Отступ контента строк от левого края элемента. В отличие от внешнего
     * паддинг-контейнера, входит в саму строку, поэтому фон курсора/выделения
     * заливает строку от края, а текст начинается со сдвигом.
     */
    private leftPadding: number;
    private typeaheadBuffer = "";
    private typeaheadTimer: ReturnType<typeof setTimeout> | null = null;

    private styles: ITreeViewStyles = unthemedTreeViewStyles;

    public onSelect: ((item: T) => void) | null = null;
    public onActivate: ((item: T) => void) | null = null;
    public onExpandedChanged: ((element: T, expanded: boolean) => void) | null = null;
    public onContextMenu: ((element: T, screenX: number, screenY: number) => void) | null = null;

    public setStyles(styles: ITreeViewStyles): void {
        this.styles = styles;
        this.markDirty();
    }

    public constructor(provider: ITreeDataProvider<T>, options?: { leftPadding?: number }) {
        super();
        this.tabIndex = 0;
        this.leftPadding = options?.leftPadding ?? 0;
        this.provider = provider;
        this.provider.onChange = (element) => {
            void this.refresh(element);
        };
    }

    public get contentHeight(): number {
        return this.flatNodes.length;
    }

    public get contentWidth(): number {
        return this.maxRowWidth;
    }

    public async refresh(element?: T): Promise<void> {
        const selectedKey = this.getSelectedKey();
        const previousIndex = this.selectedIndex;

        if (element !== undefined) {
            const key = this.provider.getKey(element);
            this.invalidateSubtreeCache(key);
            await this.reloadExpandedChildren(key);
        } else {
            this.childrenCache.clear();
            await this.loadRootChildren();
        }

        this.rebuildFlatList();
        this.restoreSelection(selectedKey, previousIndex);
        this.markDirty();
    }

    public async toggleExpand(element: T): Promise<void> {
        const key = this.provider.getKey(element);
        if (this.expandedKeys.has(key)) {
            this.expandedKeys.delete(key);
            this.onExpandedChanged?.(element, false);
        } else {
            if (!this.childrenCache.has(key)) {
                const children = await this.provider.getChildren(element);
                this.childrenCache.set(key, children);
            }
            this.expandedKeys.add(key);
            this.onExpandedChanged?.(element, true);
        }
        this.rebuildFlatList();
        this.markDirty();
    }

    /** Раскрывает узел (идемпотентно, без прокрутки/выделения) и перестраивает список. */
    public async expand(element: T): Promise<void> {
        if (this.expandedKeys.has(this.provider.getKey(element))) return;
        await this.expandElement(element);
        this.rebuildFlatList();
        this.markDirty();
    }

    /** Раскрывает узел (загружая детей в кеш), если он ещё не раскрыт. No-op для уже раскрытого. */
    private async expandElement(element: T): Promise<void> {
        const key = this.provider.getKey(element);
        if (this.expandedKeys.has(key)) return;
        if (!this.childrenCache.has(key)) {
            const children = await this.provider.getChildren(element);
            this.childrenCache.set(key, children);
        }
        this.expandedKeys.add(key);
        this.onExpandedChanged?.(element, true);
    }

    /**
     * Раскрывает цепочку предков и ставит курсор на целевой узел, проматывая к нему.
     * `chain` — путь от корня к цели включительно: все элементы кроме последнего
     * трактуются как предки-контейнеры и раскрываются, последний — цель выделения.
     * Если цель не находится в дереве после раскрытия (например, путь вне корня),
     * выделение не меняется.
     */
    public async reveal(chain: T[]): Promise<void> {
        if (chain.length === 0) return;
        for (let i = 0; i < chain.length - 1; i++) {
            await this.expandElement(chain[i]);
        }
        this.rebuildFlatList();
        const targetKey = this.provider.getKey(chain[chain.length - 1]);
        const index = this.flatNodes.findIndex((node) => this.provider.getKey(node.element) === targetKey);
        if (index >= 0) {
            this.setSelectedIndex(index);
        }
        this.markDirty();
    }

    public setCutKeys(keys: Set<string>): void {
        this.cutKeys = keys;
        this.markDirty();
    }

    public clearCutKeys(): void {
        this.cutKeys.clear();
        this.markDirty();
    }

    /** Узел под курсором, либо null если дерево пусто. */
    public getSelectedNode(): T | null {
        if (this.selectedIndex >= 0 && this.selectedIndex < this.flatNodes.length) {
            return this.flatNodes[this.selectedIndex].element;
        }
        return null;
    }

    /**
     * Глобальные экранные координаты выделенной строки — якорь для контекстного меню,
     * открытого с клавиатуры (Shift+F10). X сдвинут на отступ по глубине узла, чтобы
     * меню появлялось у имени, а не у левого края панели. Возвращает `null`, если
     * дерево пусто.
     */
    public getSelectedRowGlobalPosition(): Point | null {
        if (this.selectedIndex < 0 || this.selectedIndex >= this.flatNodes.length) return null;
        const indentX = this.rowIndentX(this.flatNodes[this.selectedIndex].depth);
        return new Point(
            this.globalPosition.x + indentX - this.scrollLeft,
            this.globalPosition.y + (this.selectedIndex - this.scrollTop),
        );
    }

    /**
     * Все выбранные узлы. Если множественный выбор пуст, возвращает узел под курсором
     * (в виде массива из одного элемента). Порядок — как в дереве.
     */
    public getSelectedNodes(): T[] {
        if (this.selectedKeys.size === 0) {
            const node = this.getSelectedNode();
            return node ? [node] : [];
        }
        const result: T[] = [];
        for (const node of this.flatNodes) {
            if (this.selectedKeys.has(this.provider.getKey(node.element))) {
                result.push(node.element);
            }
        }
        return result;
    }

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "keypress") {
            this.handleKeypress(event as TUIKeyboardEvent);
        } else if (event.type === "click") {
            this.handleClick(event as TUIMouseEvent);
        } else if (event.type === "contextmenu") {
            this.handleContextMenu(event as TUIContextMenuEvent);
        } else if (event.type === "dblclick") {
            this.handleDblClick(event as TUIMouseEvent);
        } else if (event.type === "wheel") {
            this.handleWheel(event as TUIMouseEvent);
        } else if (event.type === "mousemove") {
            this.handleMouseMove(event as TUIMouseEvent);
        } else if (event.type === "mouseleave") {
            this.handleMouseLeave();
        } else {
            super.performDefaultAction(event);
        }
    }

    protected override renderViewport(context: RenderContext, viewport: ScrollViewportInfo): void {
        const { scrollTop, scrollLeft, viewportWidth, viewportHeight } = viewport;
        const resolved = this.resolvedStyle;
        const focused = this.isFocused;

        for (let screenY = 0; screenY < viewportHeight; screenY++) {
            const nodeIndex = scrollTop + screenY;

            if (nodeIndex >= this.flatNodes.length) {
                for (let x = 0; x < viewportWidth; x++) {
                    context.setCell(x, screenY, { char: " ", fg: resolved.fg, bg: resolved.bg });
                }
                continue;
            }

            const node = this.flatNodes[nodeIndex];
            const nodeKey = this.provider.getKey(node.element);
            const isCursor = nodeIndex === this.selectedIndex;
            const isSelected = this.selectedKeys.has(nodeKey);
            const isHovered = nodeIndex === this.hoveredIndex;
            const isCut = this.cutKeys.has(nodeKey);

            const { bg: rowBg, fg: rowFg } = this.resolveRowColors(
                resolved,
                focused,
                isCursor,
                isSelected,
                isHovered,
                isCut,
            );

            const rowText = this.formatRow(node);
            const rowIcon = node.item.icon;
            const rowIconColor = node.item.iconColor;
            const labelColor = node.item.labelColor;
            // Метка имени начинается сразу после иконки типа (если она есть).
            const labelStart = this.rowIndentX(node.depth) + 2 + (rowIcon ? 2 : 0);
            // Цвет-декорация имени уступает выделению/курсору, чтобы выбранная строка
            // оставалась читаемой (тот же приоритет, что и у cutFg).
            const labelColorActive = labelColor !== undefined && !(isCursor || isSelected);
            const dl = new DisplayLine(rowText);

            let screenX = 0;
            let col = scrollLeft;
            while (col < scrollLeft + viewportWidth) {
                if (col >= dl.displayWidth) {
                    context.setCell(screenX, screenY, { char: " ", fg: resolved.fg, bg: rowBg });
                    col++;
                    screenX++;
                    continue;
                }
                const char = dl.charAtColumn(col);
                if (char === "") {
                    col++;
                    screenX++;
                    continue;
                }
                const slot = dl.graphemeAtColumn(col);
                /* v8 ignore start -- defensive: graphemeAtColumn is non-null whenever charAtColumn already returned a non-empty char */
                const w = slot ? slot.displayWidth : 1;
                /* v8 ignore stop */
                let fg = rowFg;

                // Override the name span with the git-status colour (deemphasised by
                // selection above). Applies only to the label columns, so the type icon
                // keeps its own colour.
                if (labelColorActive && col >= labelStart) {
                    fg = labelColor;
                }

                // Color the icon character
                const iconStart = this.rowIndentX(node.depth) + 2;
                if (rowIcon && rowIconColor !== undefined && col === iconStart) {
                    fg = rowIconColor;
                }

                // Color the expand icon
                const expandIconPos = this.rowIndentX(node.depth);
                if (col === expandIconPos && node.item.collapsible) {
                    fg = packRgb(150, 150, 150);
                }

                if (w === 2 && screenX + 1 >= viewportWidth) {
                    context.setCell(screenX, screenY, { char: " ", fg, bg: rowBg, width: 1 });
                    col++;
                    screenX++;
                } else {
                    context.setCell(screenX, screenY, { char, fg, bg: rowBg, width: w });
                    col += w;
                    screenX += w;
                }
            }

            // Правый край строки: буква-бейдж статуса (git) прижат к самому краю и
            // имеет приоритет; стрелка симлинка, если есть, сдвигается влево, чтобы
            // две метки не перетирали друг друга. Обе рисуются поверх крайних ячеек и
            // не входят в ширину строки — иконки типов остаются на своих местах.
            let symlinkX = viewportWidth - 1;
            if (node.item.badge) {
                const badgeChars = Array.from(node.item.badge);
                const badgeFg = labelColor ?? rowFg;
                const badgeStart = viewportWidth - badgeChars.length;
                for (let i = 0; i < badgeChars.length; i++) {
                    const x = badgeStart + i;
                    if (x >= 0) {
                        context.setCell(x, screenY, { char: badgeChars[i], fg: badgeFg, bg: rowBg, width: 1 });
                    }
                }
                symlinkX = badgeStart - 1;
            }
            if (node.item.symlink && symlinkX >= 0) {
                context.setCell(symlinkX, screenY, {
                    char: SYMLINK_BADGE,
                    fg: this.styles.symlinkFg,
                    bg: rowBg,
                    width: 1,
                });
            }
        }
    }

    private resolveRowColors(
        resolved: { fg: number; bg: number },
        focused: boolean,
        isCursor: boolean,
        isSelected: boolean,
        isHovered: boolean,
        isCut: boolean,
    ): { bg: number; fg: number } {
        // Priority: cursor/selection > hover > cut > normal
        if (isCursor || isSelected) {
            if (focused) {
                return { bg: this.styles.activeSelectionBg, fg: this.styles.activeSelectionFg };
            }
            return { bg: this.styles.inactiveSelectionBg, fg: this.styles.inactiveSelectionFg };
        }
        if (isHovered && this.styles.hoverBg !== undefined) {
            return { bg: this.styles.hoverBg, fg: this.styles.hoverFg ?? resolved.fg };
        }
        if (isCut && this.styles.cutFg !== undefined) {
            return { bg: resolved.bg, fg: this.styles.cutFg };
        }
        return { bg: resolved.bg, fg: resolved.fg };
    }

    // ─── Private: data loading ───

    private async loadRootChildren(): Promise<void> {
        const rootChildren = await this.provider.getChildren();
        this.childrenCache.set("__root__", rootChildren);

        for (const key of this.expandedKeys) {
            await this.reloadExpandedChildren(key);
        }
    }

    private async reloadExpandedChildren(key: string): Promise<void> {
        if (!this.expandedKeys.has(key)) return;

        const node = this.findElementByKey(key);
        /* v8 ignore start -- unreachable: findElementByKey always resolves an expanded key (see its own v8-ignore note) */
        if (node === null) return;
        /* v8 ignore stop */

        const children = await this.provider.getChildren(node);
        this.childrenCache.set(key, children);

        for (const child of children) {
            const childKey = this.provider.getKey(child);
            if (this.expandedKeys.has(childKey)) {
                await this.reloadExpandedChildren(childKey);
            }
        }
    }

    private invalidateSubtreeCache(key: string): void {
        const children = this.childrenCache.get(key);
        if (children) {
            for (const child of children) {
                const childKey = this.provider.getKey(child);
                this.invalidateSubtreeCache(childKey);
            }
        }
        this.childrenCache.delete(key);
    }

    // ─── Private: flat list ───

    private rebuildFlatList(): void {
        this.flatNodes = [];
        this.maxRowWidth = 0;
        const rootChildren = this.childrenCache.get("__root__");
        if (!rootChildren) return;

        this.appendChildren(rootChildren, 0, null);
    }

    private appendChildren(children: T[], depth: number, parentKey: string | null): void {
        for (const element of children) {
            const key = this.provider.getKey(element);
            const item = this.provider.getTreeItem(element);
            this.flatNodes.push({ element, depth, item, parentKey });

            const rowWidth = this.calculateRowWidth(depth, item);
            if (rowWidth > this.maxRowWidth) {
                this.maxRowWidth = rowWidth;
            }

            if (this.expandedKeys.has(key)) {
                const cachedChildren = this.childrenCache.get(key);
                /* v8 ignore start -- defensive: an expanded key always has its children cached (cache and expandedKeys stay in sync) */
                if (cachedChildren) {
                    this.appendChildren(cachedChildren, depth + 1, key);
                }
                /* v8 ignore stop */
            }
        }
    }

    /** Колонка (в координатах контента), с которой начинается строка узла данной глубины. */
    private rowIndentX(depth: number): number {
        return this.leftPadding + depth * INDENT_SIZE;
    }

    private calculateRowWidth(depth: number, item: ITreeItem): number {
        // indent + expandIcon + space + icon + space + label
        return this.rowIndentX(depth) + 2 + (item.icon ? 2 : 0) + new DisplayLine(item.label).displayWidth;
    }

    private formatRow(node: FlatTreeNode<T>): string {
        const indent = " ".repeat(this.rowIndentX(node.depth));
        const expandIcon = node.item.collapsible
            ? this.expandedKeys.has(this.provider.getKey(node.element))
                ? ICON_EXPANDED
                : ICON_COLLAPSED
            : " ";
        const icon = node.item.icon ? node.item.icon + " " : "";
        return `${indent}${expandIcon} ${icon}${node.item.label}`;
    }

    // ─── Private: selection ───

    private getSelectedKey(): string | null {
        if (this.selectedIndex >= 0 && this.selectedIndex < this.flatNodes.length) {
            return this.provider.getKey(this.flatNodes[this.selectedIndex].element);
        }
        return null;
    }

    private restoreSelection(key: string | null, previousIndex: number): void {
        if (key !== null) {
            const idx = this.flatNodes.findIndex((n) => this.provider.getKey(n.element) === key);
            if (idx >= 0) {
                this.selectedIndex = idx;
                this.selectionAnchor = idx;
                return;
            }
        }
        // The previously selected node is gone (e.g. it was deleted). Keep the cursor
        // on the nearest remaining row instead of jumping to the top of the tree: the
        // next sibling shifts into the same index, or we clamp to the last row when the
        // deleted node was last.
        if (this.flatNodes.length === 0) {
            this.selectedIndex = 0;
            this.selectionAnchor = 0;
            return;
        }
        this.selectedIndex = Math.min(Math.max(previousIndex, 0), this.flatNodes.length - 1);
        this.selectionAnchor = this.selectedIndex;
    }

    public focusPageDown(): void {
        const pageSize = Math.max(1, this.layoutSize.height - 1);
        this.setSelectedIndex(this.selectedIndex + pageSize);
    }

    public focusPageUp(): void {
        const pageSize = Math.max(1, this.layoutSize.height - 1);
        this.setSelectedIndex(this.selectedIndex - pageSize);
    }

    public focusFirst(): void {
        this.setSelectedIndex(0);
    }

    public focusLast(): void {
        this.setSelectedIndex(this.flatNodes.length - 1);
    }

    private setSelectedIndex(index: number): void {
        if (index < 0) index = 0;
        if (index >= this.flatNodes.length) index = this.flatNodes.length - 1;
        if (index < 0) return;

        this.selectedIndex = index;
        this.selectionAnchor = index;
        this.selectedKeys.clear();
        this.applyCursor(index);
    }

    /** Двигает курсор и расширяет множественный выбор диапазоном от якоря (Shift+стрелки). */
    private extendSelectionTo(index: number): void {
        if (index < 0) index = 0;
        if (index >= this.flatNodes.length) index = this.flatNodes.length - 1;
        if (index < 0) return;

        this.selectedIndex = index;
        this.selectRange(this.selectionAnchor, index);
        this.applyCursor(index);
    }

    private selectRange(anchor: number, cursor: number): void {
        const lo = Math.min(anchor, cursor);
        const hi = Math.max(anchor, cursor);
        this.selectedKeys.clear();
        for (let i = lo; i <= hi; i++) {
            this.selectedKeys.add(this.provider.getKey(this.flatNodes[i].element));
        }
    }

    /** Переключает выбор одной строки (Ctrl/Cmd+клик), не сбрасывая остальное. */
    private toggleSelectionAt(index: number): void {
        /* v8 ignore start -- defensive: the mouse handler bounds-checks the row before calling */
        if (index < 0 || index >= this.flatNodes.length) return;
        /* v8 ignore stop */
        // Первый Ctrl+клик: включаем в набор текущий курсор, чтобы он не потерялся.
        if (this.selectedKeys.size === 0) {
            this.selectedKeys.add(this.provider.getKey(this.flatNodes[this.selectedIndex].element));
        }
        const key = this.provider.getKey(this.flatNodes[index].element);
        if (this.selectedKeys.has(key)) {
            this.selectedKeys.delete(key);
        } else {
            this.selectedKeys.add(key);
        }
        this.selectedIndex = index;
        this.selectionAnchor = index;
        this.applyCursor(index);
    }

    private applyCursor(index: number): void {
        this.ensureVisible(index);
        this.onSelect?.(this.flatNodes[index].element);
        this.markDirty();
    }

    private ensureVisible(index: number): void {
        const viewportHeight = this.layoutSize.height;
        if (index < this.scrollTop) {
            this.scrollTo(this.scrollLeft, index);
        } else if (index >= this.scrollTop + viewportHeight) {
            this.scrollTo(this.scrollLeft, index - viewportHeight + 1);
        }
    }

    // ─── Private: key helpers ───

    private findElementByKey(key: string): T | null {
        for (const node of this.flatNodes) {
            if (this.provider.getKey(node.element) === key) {
                return node.element;
            }
        }
        /* v8 ignore start -- unreachable: findElementByKey is only called with keys of currently-flattened (visible) nodes, which the loop above always finds */
        // Search in cache values too
        for (const children of this.childrenCache.values()) {
            for (const child of children) {
                if (this.provider.getKey(child) === key) {
                    return child;
                }
            }
        }
        return null;
        /* v8 ignore stop */
    }

    // ─── Private: input handlers ───

    private handleKeypress(event: TUIKeyboardEvent): void {
        switch (event.key) {
            case "ArrowUp":
                if (event.shiftKey) {
                    this.extendSelectionTo(this.selectedIndex - 1);
                } else {
                    this.setSelectedIndex(this.selectedIndex - 1);
                }
                break;
            case "ArrowDown":
                if (event.shiftKey) {
                    this.extendSelectionTo(this.selectedIndex + 1);
                } else {
                    this.setSelectedIndex(this.selectedIndex + 1);
                }
                break;
            case "ArrowRight":
                void this.handleExpandOrMoveToChild();
                break;
            case "ArrowLeft":
                void this.handleCollapseOrMoveToParent();
                break;
            case "Enter":
                this.activateSelected();
                break;
            case " ":
                void this.toggleSelected();
                break;
            default:
                this.handleTypeahead(event);
                return;
        }
    }

    // ─── Private: type-ahead поиск ───

    /**
     * Быстрый поиск по набору: печатаешь символы — курсор перепрыгивает к первому узлу,
     * чья метка начинается с набранной последовательности. Повтор одного и того же
     * символа циклически перебирает совпадения; набор из разных символов уточняет
     * префикс, начиная с текущей строки. Буфер копится, пока не выйдет тайм-аут.
     */
    private handleTypeahead(event: TUIKeyboardEvent): void {
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const ch = event.key;
        // Только одиночные печатные символы: имена клавиш ("Enter", "F1"), управляющие
        // символы и пробел (уже занят разворачиванием) в поиск не идут.
        if (ch.length !== 1 || ch === " " || ch.charCodeAt(0) < 0x20) return;

        this.typeaheadBuffer += ch;
        this.restartTypeaheadTimer();
        this.jumpToTypeaheadMatch();
    }

    private restartTypeaheadTimer(): void {
        if (this.typeaheadTimer !== null) {
            clearTimeout(this.typeaheadTimer);
        }
        this.typeaheadTimer = setTimeout(() => {
            this.typeaheadTimer = null;
            this.typeaheadBuffer = "";
        }, TYPEAHEAD_TIMEOUT_MS);
        // Незавершённый таймер поиска не должен удерживать процесс от выхода.
        this.typeaheadTimer.unref();
    }

    private jumpToTypeaheadMatch(): void {
        const count = this.flatNodes.length;
        if (count === 0) return;

        const buffer = this.typeaheadBuffer.toLowerCase();
        // Повтор одного символа ("aa", "aaa") трактуем как перебор совпадений по одной
        // букве, а не как буквальный префикс — так работает быстрый поиск в проводниках.
        const allSameChar = Array.from(buffer).every((c) => c === buffer[0]);
        const prefix = allSameChar ? buffer[0] : buffer;
        // Перебор (следующая строка) — только когда пользователь реально жмёт ту же
        // клавишу повторно (буфер ≥ 2 и все символы одинаковы). Первое нажатие и
        // уточнение префикса ищут с текущей строки включительно, чтобы найти первое
        // совпадение на текущей позиции или после неё.
        const cycling = buffer.length >= 2 && allSameChar;
        const start = cycling ? this.selectedIndex + 1 : this.selectedIndex;

        for (let i = 0; i < count; i++) {
            const idx = (start + i) % count;
            const label = this.flatNodes[idx].item.label.toLowerCase();
            if (label.startsWith(prefix)) {
                this.setSelectedIndex(idx);
                return;
            }
        }
    }

    private async handleExpandOrMoveToChild(): Promise<void> {
        const node = this.flatNodes[this.selectedIndex];

        if (node.item.collapsible) {
            const key = this.provider.getKey(node.element);
            if (!this.expandedKeys.has(key)) {
                await this.toggleExpand(node.element);
            } else {
                // Already expanded — move to first child
                if (this.selectedIndex + 1 < this.flatNodes.length) {
                    const nextNode = this.flatNodes[this.selectedIndex + 1];
                    if (nextNode.depth > node.depth) {
                        this.setSelectedIndex(this.selectedIndex + 1);
                    }
                }
            }
        }
    }

    private async handleCollapseOrMoveToParent(): Promise<void> {
        const node = this.flatNodes[this.selectedIndex];

        const key = this.provider.getKey(node.element);
        if (node.item.collapsible && this.expandedKeys.has(key)) {
            await this.toggleExpand(node.element);
        } else if (node.parentKey !== null) {
            const parentIdx = this.flatNodes.findIndex((n) => this.provider.getKey(n.element) === node.parentKey);
            /* v8 ignore start -- defensive: a visible child's parent is always present in the flat list */
            if (parentIdx >= 0) {
                this.setSelectedIndex(parentIdx);
            }
            /* v8 ignore stop */
        }
    }

    private activateSelected(): void {
        const node = this.flatNodes[this.selectedIndex];
        this.onActivate?.(node.element);
    }

    private async toggleSelected(): Promise<void> {
        const node = this.flatNodes[this.selectedIndex];
        if (!node.item.collapsible) return;
        await this.toggleExpand(node.element);
    }

    /**
     * Единый вход контекстного меню: от мыши — узел под кликом (мультивыбор по
     * выбранной строке не сбрасывается), от клавиатуры — узел курсора с якорем
     * на его глобальной позиции. Виджет только сигналит {@link onContextMenu}.
     */
    private handleContextMenu(event: TUIContextMenuEvent): void {
        if (event.trigger === "mouse") {
            const index = this.scrollTop + event.localY;
            if (index < 0 || index >= this.flatNodes.length) return;
            // Не сбрасываем множественный выбор, если кликнули по уже выбранной строке.
            const key = this.provider.getKey(this.flatNodes[index].element);
            if (!this.selectedKeys.has(key)) {
                this.setSelectedIndex(index);
            } else {
                this.selectedIndex = index;
                this.applyCursor(index);
            }
            this.onContextMenu?.(this.flatNodes[index].element, event.screenX, event.screenY);
            return;
        }
        const anchor = this.getSelectedRowGlobalPosition();
        if (anchor === null || this.selectedIndex < 0 || this.selectedIndex >= this.flatNodes.length) return;
        this.onContextMenu?.(this.flatNodes[this.selectedIndex].element, anchor.x, anchor.y);
    }

    private handleClick(event: TUIMouseEvent): void {
        const index = this.scrollTop + event.localY;
        if (index < 0 || index >= this.flatNodes.length) return;

        if (event.button !== "left") return; // правый клик несёт событие contextmenu

        if (event.ctrlKey) {
            this.toggleSelectionAt(index);
            return;
        }

        if (event.shiftKey) {
            this.selectedIndex = index;
            this.selectRange(this.selectionAnchor, index);
            this.applyCursor(index);
            return;
        }

        this.setSelectedIndex(index);

        // Check if clicked on expand icon area
        const node = this.flatNodes[index];
        const expandIconX = this.rowIndentX(node.depth);
        const clickX = this.scrollLeft + event.localX;
        if (node.item.collapsible && clickX >= expandIconX && clickX <= expandIconX + 1) {
            void this.toggleExpand(node.element);
        }
    }

    private handleDblClick(event: TUIMouseEvent): void {
        const index = this.scrollTop + event.localY;
        if (index < 0 || index >= this.flatNodes.length) return;

        const node = this.flatNodes[index];
        if (node.item.collapsible) {
            void this.toggleExpand(node.element);
        } else {
            this.onActivate?.(node.element);
        }
    }

    private handleMouseMove(event: TUIMouseEvent): void {
        const index = this.scrollTop + event.localY;
        const newHovered = index >= 0 && index < this.flatNodes.length ? index : null;
        if (newHovered !== this.hoveredIndex) {
            this.hoveredIndex = newHovered;
            this.markDirty();
        }
    }

    private handleMouseLeave(): void {
        if (this.hoveredIndex !== null) {
            this.hoveredIndex = null;
            this.markDirty();
        }
    }

    private handleWheel(event: TUIMouseEvent): void {
        if (event.wheelDirection === "up") {
            this.scrollBy(0, -3);
        } else if (event.wheelDirection === "down") {
            this.scrollBy(0, 3);
        }
        this.markDirty();
    }
}
