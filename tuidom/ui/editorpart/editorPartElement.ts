import { BoxConstraints, Size } from "../../common/geometryPromitives.ts";
import { TUIElement } from "../../dom/tuiElement.ts";
import { SashElement } from "../sash/sashElement.ts";

/** Ось полосы групп: колонки (сплиты слева-направо) или ряды (сверху-вниз). */
export type EditorPartOrientation = "columns" | "rows";

/** Минимальная ширина группы в колонках — узже таб-стрип и код нечитаемы. */
export const MIN_GROUP_MAIN_COLS = 20;
/** Минимальная высота группы в рядах — таб-стрип + пара строк кода. */
export const MIN_GROUP_MAIN_ROWS = 5;

/**
 * Полоса групп редакторов по одной оси (аналог grid-вью `EditorPart` VS Code,
 * сведённого к одному ряду/колонке): N вью групп + N−1 сашей между ними.
 * Пропорции — нормированные веса, переживают ресайз терминала; политику весов
 * при сплите/схлопывании задаёт владелец (`EditorPartComponent`) через
 * {@link setViews}. Саши лежат ПОВЕРХ граничной ячейки (пуш последними —
 * hit-test): в columns — поверх первой колонки следующей группы, в rows —
 * поверх ПОСЛЕДНЕЙ строки предыдущей: первая строка нижней группы это её
 * табы, и наложение отняло бы у них мышь, а нижняя строка редактора менее
 * ценна. Каждый саш укладывается явно в каждом layout.
 *
 * Деградация «не влезаем»: контейнер уже, чем N×минимум, — display-only равное
 * деление без мутации весов; при возврате размера пропорции восстанавливаются.
 * Отказ в НОВОМ сплите при нехватке места — {@link canFit}, решает владелец.
 */
export class EditorPartElement extends TUIElement {
    private views: TUIElement[] = [];
    /** Нормированные доли групп; длина всегда равна `views.length`. */
    private weightsValue: number[] = [];
    private sashes: SashElement[] = [];
    private orientationValue: EditorPartOrientation = "columns";
    private maximizedIndexValue: number | null = null;
    /** Основные размеры групп из последнего layout — база для drag-математики. */
    private lastSizes: number[] = [];

    /**
     * Смена весов действием пользователя (drag саша, nudge/even команды) — для
     * персиста. Плейн-колбэк (TUIDom без DI); НЕ вызывается из performLayout.
     */
    public onDidChangeWeights?: () => void;

    /** Ось полосы. Смена сохраняет веса (US-19: тумблер не теряет пропорций). */
    public get orientation(): EditorPartOrientation {
        return this.orientationValue;
    }

    public set orientation(value: EditorPartOrientation) {
        if (this.orientationValue === value) return;
        this.orientationValue = value;
        this.rebuildSashes();
        this.markDirty();
    }

    /** Нормированные доли групп (копия). */
    public get weights(): readonly number[] {
        return [...this.weightsValue];
    }

    /** Индекс максимизированной группы, либо `null` (обычная полоса). */
    public get maximizedIndex(): number | null {
        return this.maximizedIndexValue;
    }

    public set maximizedIndex(value: number | null) {
        const clamped = value !== null && value >= 0 && value < this.views.length ? value : null;
        if (this.maximizedIndexValue === clamped) return;
        this.maximizedIndexValue = clamped;
        this.syncChildren();
        this.markDirty();
    }

    /**
     * Задаёт состав полосы и доли. Политика долей — у владельца (сплит делит
     * долю активной группы пополам, join отдаёт долю соседу и т.п.); элемент
     * лишь нормирует. Пустые/невалидные веса → равные доли. Максимизация
     * сбрасывается: состав сменился, старый индекс — про другую полосу.
     */
    public setViews(views: TUIElement[], weights?: readonly number[]): void {
        this.views = [...views];
        const raw = weights !== undefined && weights.length === views.length ? [...weights] : [];
        this.weightsValue = this.normalizeWeights(raw);
        this.maximizedIndexValue = null;
        this.rebuildSashes();
        this.markDirty();
    }

    /** Выравнивает доли (Reset Editor Group Sizes). */
    public evenWeights(): void {
        if (this.views.length === 0) return;
        this.weightsValue = this.normalizeWeights([]);
        this.markDirty();
        this.onDidChangeWeights?.();
    }

    /**
     * Задаёт доли программно (рестор персиста). Невалидные/чужой длины веса
     * нормализуются в равные; событие не файрится — это не действие пользователя.
     */
    public setWeights(weights: readonly number[]): void {
        this.weightsValue = this.normalizeWeights([...weights]);
        this.markDirty();
    }

    /**
     * Меняет основной размер группы `index` на `deltaCells` ячеек за счёт соседа
     * справа/снизу (последняя группа растёт за счёт соседа слева/сверху) —
     * increase/decreaseEditorWidth/Height. Кламп по минимуму обеих.
     */
    public nudgeWeight(index: number, deltaCells: number): void {
        if (this.views.length < 2 || index < 0 || index >= this.views.length) return;
        const neighbor = index < this.views.length - 1 ? index + 1 : index - 1;
        const sizes = this.currentSizes();
        if (sizes === null) return;
        const min = this.minMainSize();
        const pair = sizes[index] + sizes[neighbor];
        const target = Math.max(min, Math.min(sizes[index] + deltaCells, pair - min));
        sizes[index] = target;
        sizes[neighbor] = pair - target;
        this.weightsValue = this.normalizeWeights(sizes);
        this.markDirty();
        this.onDidChangeWeights?.();
    }

    /** Влезет ли полоса из `count` групп в текущий основной размер. */
    public canFit(count: number): boolean {
        const main = this.mainAxisSize();
        // До первого layout судить не по чему — не отказываем (рестор решает сам).
        if (main <= 0) return true;
        return count * this.minMainSize() <= main;
    }

    public override inspectState(): Record<string, unknown> {
        return {
            orientation: this.orientationValue,
            weights: this.weightsValue.map((w) => Number(w.toFixed(4))),
            maximizedIndex: this.maximizedIndexValue,
            groupCount: this.views.length,
        };
    }

    /** Основной размер полосы по текущей оси (из последнего layout). */
    private mainAxisSize(): number {
        return this.orientationValue === "columns" ? this.layoutSize.width : this.layoutSize.height;
    }

    private minMainSize(): number {
        return this.orientationValue === "columns" ? MIN_GROUP_MAIN_COLS : MIN_GROUP_MAIN_ROWS;
    }

    /** Текущие основные размеры групп; `null` до первого layout. */
    private currentSizes(): number[] | null {
        if (this.lastSizes.length !== this.views.length) return null;
        return [...this.lastSizes];
    }

    /** Нормирует произвольные положительные величины в доли; пусто/мусор → равные. */
    private normalizeWeights(raw: readonly number[]): number[] {
        const count = this.views.length;
        if (count === 0) return [];
        const positive = raw.length === count && raw.every((w) => Number.isFinite(w) && w > 0);
        if (!positive) return new Array<number>(count).fill(1 / count);
        const total = raw.reduce((sum, w) => sum + w, 0);
        return raw.map((w) => w / total);
    }

    /** Пересоздаёт N−1 сашей под текущие состав и ось; вешает drag-обработчики. */
    private rebuildSashes(): void {
        const sashOrientation = this.orientationValue === "columns" ? "vertical" : "horizontal";
        this.sashes = this.views.slice(1).map((_, i) => {
            const sash = new SashElement(sashOrientation);
            sash.onDrag = (boundaryScreen) => {
                this.handleSashDrag(i, boundaryScreen);
            };
            return sash;
        });
        this.syncChildren();
    }

    /** Дети: вью групп, затем саши (поверх границ — hit-test); максимизация прячет прочее. */
    private syncChildren(): void {
        const maximized = this.maximizedIndexValue;
        for (const [i, view] of this.views.entries()) {
            view.hidden = maximized !== null && i !== maximized;
        }
        for (const sash of this.sashes) {
            sash.hidden = maximized !== null;
        }
        this.setChildren([...this.views, ...this.sashes]);
    }

    /**
     * Drag саша `index` (граница групп index/index+1): абсолютная координата →
     * новый размер левой/верхней группы, кламп по минимуму пары, веса — из
     * фактических размеров. Веса остальных групп не трогаются.
     */
    private handleSashDrag(index: number, boundaryScreen: number): void {
        const sizes = this.currentSizes();
        if (sizes === null) return;
        const origin =
            this.orientationValue === "columns" ? this.globalPosition.x : this.globalPosition.y;
        let offset = 0;
        for (let i = 0; i < index; i++) offset += sizes[i];
        const min = this.minMainSize();
        const pair = sizes[index] + sizes[index + 1];
        // В rows саш лежит на последней строке верхней группы (не на первой
        // нижней) — курсор на строке Y означает размер верхней Y+1.
        const inset = this.orientationValue === "rows" ? 1 : 0;
        const target = Math.max(min, Math.min(boundaryScreen - origin - offset + inset, pair - min));
        sizes[index] = target;
        sizes[index + 1] = pair - target;
        this.weightsValue = this.normalizeWeights(sizes);
        this.markDirty();
        this.onDidChangeWeights?.();
    }

    /**
     * Целочисленные основные размеры из долей: floor + остатки самым большим
     * дробным частям (сумма всегда равна `mainSize`), затем min-клампы за счёт
     * самых широких. Полоса уже N×минимума — display-only равное деление, веса
     * не мутируются (US-25: пропорции восстановятся при возврате размера).
     */
    private computeSizes(mainSize: number): number[] {
        const count = this.views.length;
        /* v8 ignore next -- performLayout не зовёт с пустой полосой */
        if (count === 0) return [];
        const min = this.minMainSize();

        if (mainSize < count * min) {
            return this.distributeEvenly(mainSize, count);
        }

        const raw = this.weightsValue.map((w) => w * mainSize);
        const sizes = raw.map((r) => Math.floor(r));
        let remainder = mainSize - sizes.reduce((sum, s) => sum + s, 0);
        const byFraction = raw
            .map((r, i) => ({ i, frac: r - Math.floor(r) }))
            .sort((a, b) => b.frac - a.frac);
        for (const { i } of byFraction) {
            if (remainder <= 0) break;
            sizes[i]++;
            remainder--;
        }

        // Min-клампы: добираем дефицит у самых больших (влезаем по проверке выше).
        for (let i = 0; i < count; i++) {
            while (sizes[i] < min) {
                const largest = sizes.indexOf(Math.max(...sizes));
                /* v8 ignore next -- защитный выход: mainSize >= count*min гарантирует донора */
                if (largest === i || sizes[largest] <= min) break;
                sizes[largest]--;
                sizes[i]++;
            }
        }
        return sizes;
    }

    private distributeEvenly(mainSize: number, count: number): number[] {
        const base = Math.floor(mainSize / count);
        const sizes = new Array<number>(count).fill(base);
        for (let i = 0; i < mainSize - base * count; i++) sizes[i]++;
        return sizes;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const containerSize = super.performLayout(constraints);
        if (this.views.length === 0) {
            this.lastSizes = [];
            return containerSize;
        }

        const maximized = this.maximizedIndexValue;
        if (maximized !== null) {
            // Максимизированная группа занимает всё; остальные скрыты (hidden в
            // syncChildren), их layout не трогаем — размеры вернутся с полосой.
            this.layoutChild(this.views[maximized], 0, 0, BoxConstraints.tight(containerSize));
            return containerSize;
        }

        const columns = this.orientationValue === "columns";
        const mainSize = columns ? containerSize.width : containerSize.height;
        const sizes = this.computeSizes(mainSize);
        this.lastSizes = [...sizes];

        let offset = 0;
        for (const [i, view] of this.views.entries()) {
            const size = columns
                ? new Size(sizes[i], containerSize.height)
                : new Size(containerSize.width, sizes[i]);
            this.layoutChild(view, columns ? offset : 0, columns ? 0 : offset, BoxConstraints.tight(size));
            offset += sizes[i];

            // Саш i на границе групп i/i+1: в columns — поверх первой колонки
            // следующей группы, в rows — поверх последней строки предыдущей
            // (первая строка нижней это её табы). Явная укладка каждый layout:
            // ленивый layoutSize со старым боксом ломает hit-test (контракт
            // WorkbenchLayoutElement).
            if (i < this.sashes.length) {
                const sashSize = columns ? new Size(1, containerSize.height) : new Size(containerSize.width, 1);
                const sashMain = columns ? offset : Math.max(0, offset - 1);
                this.layoutChild(this.sashes[i], columns ? sashMain : 0, columns ? 0 : sashMain, BoxConstraints.tight(sashSize));
            }
        }
        return containerSize;
    }
}
