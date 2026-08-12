import { BoxConstraints, Size } from "../../../../../../tuidom/common/geometryPromitives.ts";
import { RenderContext, TUIElement } from "../../../../../../tuidom/dom/tuiElement.ts";

/** Вертикальный разделитель колонок side-by-side. */
const COLUMN_SEPARATOR = "│";

/** Отступ подписи колонки от левого края её текстовой зоны. */
const LABEL_PADDING = 1;

/**
 * Ряд заголовков колонок — дети сдвинуты под него. Модульная константа, а не
 * статик класса: статическая само-ссылка заставляет esbuild переименовать класс
 * (`var X = class _X`), и `constructor.name` в бинаре перестаёт совпадать с
 * типом узла инспектора — e2e-селекторы слепнут.
 */
export const DIFF_HEADER_ROWS = 1;

/**
 * Минимальная ширина (в колонках), при которой дифф рисуется side-by-side —
 * аналог `diffEditor.renderSideBySideInlineBreakpoint` VS Code. Порог — ширина
 * САМОГО ЭЛЕМЕНТА, не терминала: сайдбар и скроллбар съедают ~20 колонок,
 * поэтому 100 здесь — это терминал от ~120 колонок с открытым сайдбаром (узже
 * него две колонки по ~45 знаков текста перестают вмещать осмысленный код).
 * Урок первой смотрелки: порог по терминалу оставлял inline даже на 140.
 */
export const SIDE_BY_SIDE_MIN_COLS = 100;

/**
 * Гистерезис авто-порога: выход из inline требует чуть больше ширины, чем вход
 * в него, — дрожание ширины (сайдбар, скроллбар) не переклеивает режим.
 */
const SIDE_BY_SIDE_EXIT_COLS = SIDE_BY_SIDE_MIN_COLS + 4;

/** Режим отображения пары. */
export type DiffPaneMode = "side-by-side" | "inline";

/** Принуждение режима: `auto` — по ширине элемента с гистерезисом. */
export type DiffPaneModeOverride = "auto" | DiffPaneMode;

/**
 * Контейнер дифф-вкладки v2: строка заголовков с подписями сторон (US-14) и —
 * в side-by-side — две колонки 50/50 с колонкой-разделителем; в inline (узкий
 * терминал, US-21) original-сторона скрыта, modified занимает всю ширину, а
 * удалённые строки показывает зонами-призраками (раскладку даёт панель).
 *
 * Режим — чистая функция ширины элемента (с гистерезисом) и `modeOverride`;
 * решает layout, о смене сообщает {@link onDidChangeMode} — владелец
 * (DiffEditorPane2) перекладывает зоны ОТЛОЖЕННО: правка зон прямо из layout
 * оставила бы корень layout-грязным после кадра (dirty-гейт TuiApplication).
 */
export class DiffPaneElement extends TUIElement {
    /** Колбэк владельцу о фактической смене режима (зовётся из layout). */
    public onDidChangeMode?: (mode: DiffPaneMode) => void;

    private modeValue: DiffPaneMode = "side-by-side";
    private overrideValue: DiffPaneModeOverride = "auto";

    public constructor(
        private readonly left: TUIElement,
        private readonly right: TUIElement,
        private readonly labels: { readonly original: string; readonly modified: string },
    ) {
        super();
        this.appendChild(left);
        this.appendChild(right);
    }

    /** Текущий фактический режим пары. */
    public get mode(): DiffPaneMode {
        return this.modeValue;
    }

    /** Принуждение режима (тумблер US-22); `auto` возвращает авто-порог. */
    public setModeOverride(override: DiffPaneModeOverride): void {
        if (this.overrideValue === override) return;
        this.overrideValue = override;
        this.markDirty();
        // До ближайшего layout ширина известна — применяем сразу, чтобы
        // владелец мог переложить зоны синхронно с командой.
        this.applyMode(this.resolveMode(this.layoutSize.width));
    }

    /** X колонки-разделителя при текущей ширине. */
    public get separatorColumn(): number {
        return Math.floor((this.layoutSize.width - 1) / 2);
    }

    public override inspectState(): Record<string, unknown> {
        return { mode: this.modeValue, override: this.overrideValue };
    }

    private resolveMode(width: number): DiffPaneMode {
        if (this.overrideValue !== "auto") return this.overrideValue;
        // Гистерезис: порог выхода из inline выше порога входа.
        if (this.modeValue === "inline") return width >= SIDE_BY_SIDE_EXIT_COLS ? "side-by-side" : "inline";
        return width < SIDE_BY_SIDE_MIN_COLS ? "inline" : "side-by-side";
    }

    private applyMode(mode: DiffPaneMode): void {
        if (mode === this.modeValue) return;
        this.modeValue = mode;
        this.left.hidden = mode === "inline";
        this.onDidChangeMode?.(mode);
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const size = super.performLayout(constraints);
        this.applyMode(this.resolveMode(size.width));
        const childHeight = Math.max(0, size.height - DIFF_HEADER_ROWS);

        if (this.modeValue === "inline") {
            this.layoutChild(this.right, 0, DIFF_HEADER_ROWS, BoxConstraints.tight(new Size(size.width, childHeight)));
            return size;
        }

        const separator = Math.floor((size.width - 1) / 2);
        const rightWidth = Math.max(0, size.width - separator - 1);
        this.layoutChild(this.left, 0, DIFF_HEADER_ROWS, BoxConstraints.tight(new Size(separator, childHeight)));
        this.layoutChild(
            this.right,
            separator + 1,
            DIFF_HEADER_ROWS,
            BoxConstraints.tight(new Size(rightWidth, childHeight)),
        );
        return size;
    }

    public render(context: RenderContext): void {
        const fg = this.styleVar("editorLineNumber.foreground");
        const bg = this.resolvedStyle.bg;

        if (this.modeValue === "inline") {
            // Одна строка заголовка на обе стороны: колонок нет.
            const label = `${this.labels.original} ↔ ${this.labels.modified}`;
            context.drawText(LABEL_PADDING, 0, label.slice(0, Math.max(0, this.layoutSize.width - LABEL_PADDING)), {
                fg,
                bg,
            });
            this.renderChildren(context);
            return;
        }

        const separator = this.separatorColumn;
        // Подписи колонок: обрезаются по ширине своей колонки, чтобы длинная
        // метка не переползла разделитель.
        const leftLabel = this.labels.original.slice(0, Math.max(0, separator - LABEL_PADDING));
        const rightWidth = Math.max(0, this.layoutSize.width - separator - 1);
        const rightLabel = this.labels.modified.slice(0, Math.max(0, rightWidth - LABEL_PADDING));
        context.drawText(LABEL_PADDING, 0, leftLabel, { fg, bg });
        context.drawText(separator + 1 + LABEL_PADDING, 0, rightLabel, { fg, bg });
        for (let y = 0; y < this.layoutSize.height; y++) {
            context.setCell(separator, y, { char: COLUMN_SEPARATOR, fg, bg, width: 1 });
        }
        this.renderChildren(context);
    }
}
