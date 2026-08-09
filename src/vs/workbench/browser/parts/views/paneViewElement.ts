import { BoxConstraints, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";

import type { IPaneMenuAnchor } from "./paneHeaderElement.ts";
import { PaneHeaderElement } from "./paneHeaderElement.ts";
import type { IViewTitleAction } from "./viewTitleRowElement.ts";

/** Секция под заголовком короче этого не имеет смысла — кламп drag и раздачи высот. */
const DEFAULT_MIN_BODY_HEIGHT = 3;

export interface IPaneOptions {
    /**
     * Уникален в контейнере. Заголовок получает `id = paneHeader-<id>` с точками,
     * заменёнными на дефисы — точка в селекторах инспектора/e2e не поддерживается
     * (`workbench.scm.graph` → `#paneHeader-workbench-scm-graph`).
     */
    readonly id: string;
    /** Название секции — рисуется как есть (конвенция VS Code: КАПСОМ). */
    readonly title: string;
    readonly body: TUIElement;
    readonly minBodyHeight?: number;
    /**
     * false — секция не сворачивается: без шеврона, клик/Enter по заголовку
     * ничего не делают (merged одно-view контейнер, как в VS Code). По
     * умолчанию true.
     */
    readonly collapsible?: boolean;
}

interface PaneRecord {
    readonly id: string;
    readonly header: PaneHeaderElement;
    /** Меняется на месте через {@link PaneViewElement.setPaneBody} — без пересборки секций. */
    body: TUIElement;
    readonly minBodyHeight: number;
    readonly collapsible: boolean;
    collapsed: boolean;
    /** Доля высоты среди развёрнутых секций; после drag — фактические строки. */
    weight: number;
    /** Высота тела из последнего layout — база для перевода drag-дельты в строки. */
    lastBodyHeight: number;
}

/**
 * Контейнер view-секций сайдбара (аналог PaneView/SplitView VS Code): стопка
 * сворачиваемых секций, у каждой — заголовок {@link PaneHeaderElement} ровно в
 * 1 строку и тело. Развёрнутые тела делят остаток высоты пропорционально
 * весам (детерминированный largest remainder с клампом `minBodyHeight`);
 * свёрнутое тело остаётся в дереве с `hidden = true` (стили и root доходят,
 * layout/render пропускаются). Граница между секциями — сам заголовок нижней:
 * его drag перекидывает строки между парой соседних развёрнутых секций, после
 * чего веса замораживаются в фактические высоты (write-through у подписчика).
 *
 * Живёт в workbench, а не в tuidom: это составной виджет из готовых контролов,
 * своя тут только раскладка (прецедент — SearchViewElement).
 */
export class PaneViewElement extends TUIElement {
    /**
     * Collapse/resize по действию пользователя — подписчик (ViewsService)
     * персистит состояние. НЕ зовётся из performLayout и программных сеттеров.
     */
    public onDidChangeState?: () => void;
    /** Запрос меню «⋯» секции (клик по кнопке, правый клик, Shift+F10). */
    public onDidRequestPaneMenu?: (paneId: string, anchor: IPaneMenuAnchor) => void;
    /** Клик по inline-кнопке заголовка секции. */
    public onDidRequestPaneAction?: (paneId: string, actionId: string) => void;

    private panes: PaneRecord[] = [];

    /** Добавляет секцию в конец (порядок добавления = порядок на экране). */
    public addPane(options: IPaneOptions): void {
        if (this.findPane(options.id) !== undefined) {
            throw new Error(`PaneViewElement: duplicate pane id "${options.id}"`);
        }
        const collapsible = options.collapsible ?? true;
        const header = new PaneHeaderElement(options.title, { collapsible });
        header.id = `paneHeader-${options.id.replaceAll(".", "-")}`;
        const record: PaneRecord = {
            id: options.id,
            header,
            body: options.body,
            minBodyHeight: options.minBodyHeight ?? DEFAULT_MIN_BODY_HEIGHT,
            collapsible,
            collapsed: false,
            weight: 1,
            lastBodyHeight: 0,
        };
        header.onToggle = () => this.toggleCollapsed(record.id);
        header.onDrag = (boundaryScreenY) => this.dragBoundary(record, boundaryScreenY);
        header.onMenu = (anchor) => this.onDidRequestPaneMenu?.(record.id, anchor);
        header.onAction = (actionId) => this.onDidRequestPaneAction?.(record.id, actionId);
        this.panes.push(record);
        this.appendChild(header);
        this.appendChild(options.body);
        this.syncPanes();
        this.markDirty();
    }

    public removePane(id: string): void {
        const pane = this.findPane(id);
        if (pane === undefined) return;
        this.removeChild(pane.header);
        this.removeChild(pane.body);
        this.panes = this.panes.filter((p) => p !== pane);
        this.syncPanes();
        this.markDirty();
    }

    /**
     * Подменяет тело секции на месте: свёрнутость, вес и позиция секции
     * сохраняются (пересборка через remove/add их бы сбросила). Нужен фичам,
     * которые переключают контент между «есть данные» и placeholder'ом.
     */
    public setPaneBody(id: string, body: TUIElement): void {
        const pane = this.paneOrThrow(id);
        if (pane.body === body) return;
        this.removeChild(pane.body);
        pane.body = body;
        body.hidden = pane.collapsed;
        this.appendChild(body);
        this.markDirty();
    }

    /** Inline-кнопки в заголовке секции (группа `navigation` её меню). */
    public setPaneActions(id: string, actions: readonly IViewTitleAction[]): void {
        this.paneOrThrow(id).header.setActions(actions);
    }

    /** Произвольный контрол в заголовке секции (переключатель каналов Output). */
    public setPaneTitleWidget(id: string, widget: TUIElement | null): void {
        this.paneOrThrow(id).header.setTitleWidget(widget);
    }

    public getPaneIds(): readonly string[] {
        return this.panes.map((p) => p.id);
    }

    public isCollapsed(id: string): boolean {
        return this.paneOrThrow(id).collapsed;
    }

    /** Программный путь (restore из персиста) — без {@link onDidChangeState}. */
    public setCollapsed(id: string, collapsed: boolean): void {
        this.applyCollapsed(this.paneOrThrow(id), collapsed);
    }

    /** Пользовательский путь (клик/Enter по заголовку) — с {@link onDidChangeState}. */
    public toggleCollapsed(id: string): void {
        const pane = this.paneOrThrow(id);
        if (!pane.collapsible) return;
        this.applyCollapsed(pane, !pane.collapsed);
        this.onDidChangeState?.();
    }

    public getWeights(): Readonly<Record<string, number>> {
        return Object.fromEntries(this.panes.map((p) => [p.id, p.weight]));
    }

    /** Restore весов: незнакомые id игнорируются, отсутствующие остаются как есть. */
    public setWeights(weights: Readonly<Record<string, number>>): void {
        for (const pane of this.panes) {
            const weight = weights[pane.id];
            if (typeof weight === "number" && Number.isFinite(weight) && weight > 0) {
                pane.weight = Math.round(weight);
            }
        }
        this.markDirty();
    }

    /** Фокус заголовку секции (клавиатурная навигация, тесты). */
    public focusPane(id: string): void {
        this.paneOrThrow(id).header.focus();
    }

    private findPane(id: string): PaneRecord | undefined {
        return this.panes.find((p) => p.id === id);
    }

    private paneOrThrow(id: string): PaneRecord {
        const pane = this.findPane(id);
        if (pane === undefined) throw new Error(`PaneViewElement: unknown pane id "${id}"`);
        return pane;
    }

    private applyCollapsed(pane: PaneRecord, collapsed: boolean): void {
        // Несворачиваемая секция игнорирует и протухший персист, и (теоретический)
        // пользовательский путь — заголовок onToggle и так не шлёт.
        if (!pane.collapsible) return;
        if (pane.collapsed === collapsed) return;
        pane.collapsed = collapsed;
        pane.header.setExpanded(!collapsed);
        if (collapsed) this.rescueFocus(pane);
        this.syncPanes();
        this.markDirty();
    }

    /** Фокус из скрываемого тела переносится на заголовок его секции. */
    private rescueFocus(pane: PaneRecord): void {
        let element = this.getRoot()?.focusManager?.activeElement ?? null;
        while (element !== null) {
            if (element === pane.body) {
                pane.header.focus();
                return;
            }
            element = element.getParent();
        }
    }

    /** Держит производные флаги детей: hidden свёрнутых тел, доступность drag. */
    private syncPanes(): void {
        for (let i = 0; i < this.panes.length; i++) {
            const pane = this.panes[i];
            pane.body.hidden = pane.collapsed;
            // Drag заголовка двигает границу над собой — нужен развёрнутый сосед
            // сверху (у кого забирать строки) и развёрнутый от себя и ниже.
            const hasExpandedAbove = this.panes.slice(0, i).some((p) => !p.collapsed);
            const hasExpandedBelow = this.panes.slice(i).some((p) => !p.collapsed);
            pane.header.setDragEnabled(hasExpandedAbove && hasExpandedBelow);
        }
    }

    private dragBoundary(pane: PaneRecord, boundaryScreenY: number): void {
        const index = this.panes.indexOf(pane);
        const abovePane = [...this.panes.slice(0, index)].reverse().find((p) => !p.collapsed);
        const belowPane = this.panes.slice(index).find((p) => !p.collapsed);
        if (abovePane === undefined || belowPane === undefined) return;

        const delta = boundaryScreenY - pane.header.globalPosition.y;
        if (delta === 0) return;
        const heightAbove = abovePane.lastBodyHeight;
        const heightBelow = belowPane.lastBodyHeight;
        // Двум секциям может быть тесно (сумма меньше двух минимумов после
        // клипа) — тогда границу не двигаем вовсе.
        if (heightAbove + heightBelow < abovePane.minBodyHeight + belowPane.minBodyHeight) return;
        const newAbove = Math.max(
            abovePane.minBodyHeight,
            Math.min(heightAbove + delta, heightAbove + heightBelow - belowPane.minBodyHeight),
        );
        const applied = newAbove - heightAbove;
        if (applied === 0) return;

        abovePane.lastBodyHeight = heightAbove + applied;
        belowPane.lastBodyHeight = heightBelow - applied;
        // Веса замораживаются в фактические высоты: следующий layout при том же
        // остатке воспроизводит их точно (largest remainder без дробей).
        for (const p of this.panes) {
            if (!p.collapsed) p.weight = Math.max(1, p.lastBodyHeight);
        }
        this.markDirty();
        this.onDidChangeState?.();
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        const avail = Math.max(0, size.height - this.panes.length);
        const heights = this.computeBodyHeights(avail);

        let y = 0;
        for (let i = 0; i < this.panes.length; i++) {
            const pane = this.panes[i];
            // Заголовки раскладываются всегда: при нехватке высоты хвостовые
            // клипуются нулевой высотой (инвариант вложенности).
            const headerHeight = Math.max(0, Math.min(1, size.height - y));
            this.layoutChild(pane.header, 0, y, BoxConstraints.tight(new Size(size.width, headerHeight)));
            y += headerHeight;
            if (pane.collapsed) {
                pane.lastBodyHeight = 0;
                continue;
            }
            const bodyHeight = Math.max(0, Math.min(heights[i], size.height - y));
            this.layoutChild(pane.body, 0, y, BoxConstraints.tight(new Size(size.width, bodyHeight)));
            pane.lastBodyHeight = bodyHeight;
            y += bodyHeight;
        }
        return size;
    }

    /** Высоты тел по индексам секций (0 — свёрнутые/за пределами высоты). */
    private computeBodyHeights(avail: number): number[] {
        const heights = this.panes.map(() => 0);
        const expanded = this.panes.map((pane, index) => ({ pane, index })).filter(({ pane }) => !pane.collapsed);
        if (expanded.length === 0 || avail <= 0) return heights;
        if (expanded.length === 1) {
            heights[expanded[0].index] = avail;
            return heights;
        }
        const shares = distributeByWeight(
            avail,
            expanded.map(({ pane }) => pane.weight),
        );
        // Кламп minBodyHeight жадно в порядке секций: сумма desired ≥ avail,
        // поэтому остаток исчерпывается, а хвостовые могут получить 0.
        let remaining = avail;
        expanded.forEach(({ pane, index }, k) => {
            const desired = Math.max(pane.minBodyHeight, shares[k]);
            const height = Math.min(desired, remaining);
            heights[index] = height;
            remaining -= height;
        });
        return heights;
    }

    public override inspectState(): Record<string, unknown> {
        return {
            panes: this.panes.map((p) => ({
                id: p.id,
                collapsed: p.collapsed,
                weight: p.weight,
                bodyHeight: p.lastBodyHeight,
            })),
        };
    }
}

/**
 * Детерминированный largest remainder: целые доли `total` пропорционально
 * весам; остаток — по убыванию дробной части, при равенстве — более ранней
 * секции. Веса всегда положительные (инициализация единицей, setWeights
 * отфильтровывает мусор, drag клампит снизу единицей).
 */
function distributeByWeight(total: number, weights: readonly number[]): number[] {
    const sum = weights.reduce((a, b) => a + b, 0);
    const base = weights.map((w) => Math.floor((total * w) / sum));
    let remainder = total - base.reduce((a, b) => a + b, 0);
    const order = weights
        .map((w, i) => ({ i, frac: (total * w) / sum - base[i] }))
        .sort((a, b) => b.frac - a.frac || a.i - b.i);
    for (const { i } of order) {
        if (remainder <= 0) break;
        base[i] += 1;
        remainder -= 1;
    }
    return base;
}
