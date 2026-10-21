import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

const COLUMN_SEPARATOR = "│";

const LABEL_PADDING = 1;

/**
 * Модульная константа, а не статик класса: статическая само-ссылка заставляет
 * esbuild переименовать класс (`class _X`), и e2e-селекторы по `constructor.name` слепнут.
 */
export const DIFF_HEADER_ROWS = 1;

/**
 * Аналог `diffEditor.renderSideBySideInlineBreakpoint`. Порог — ширина САМОГО
 * ЭЛЕМЕНТА, не терминала: порог по терминалу оставлял inline даже на 140.
 */
export const SIDE_BY_SIDE_MIN_COLS = 100;

/** Гистерезис: дрожание ширины (сайдбар, скроллбар) не переклеивает режим. */
const SIDE_BY_SIDE_EXIT_COLS = SIDE_BY_SIDE_MIN_COLS + 4;

export type DiffPaneMode = "side-by-side" | "inline";

export type DiffPaneModeOverride = "auto" | DiffPaneMode;

/**
 * О смене режима сообщает из layout; владелец перекладывает зоны ОТЛОЖЕННО — правка
 * зон прямо из layout оставила бы корень layout-грязным после кадра (dirty-гейт).
 */
export class DiffPaneElement extends TUIElement {
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

    public get mode(): DiffPaneMode {
        return this.modeValue;
    }

    public setModeOverride(override: DiffPaneModeOverride): void {
        if (this.overrideValue === override) return;
        this.overrideValue = override;
        this.markDirty();
        // Ширина известна до layout — применяем сразу, чтобы владелец переложил
        // зоны синхронно с командой.
        this.applyMode(this.resolveMode(this.layoutSize.width));
    }

    public get separatorColumn(): number {
        return Math.floor((this.layoutSize.width - 1) / 2);
    }

    public override inspectState(): Record<string, unknown> {
        return { mode: this.modeValue, override: this.overrideValue };
    }

    private resolveMode(width: number): DiffPaneMode {
        if (this.overrideValue !== "auto") return this.overrideValue;
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
            const label = `${this.labels.original} ↔ ${this.labels.modified}`;
            context.drawText(LABEL_PADDING, 0, label.slice(0, Math.max(0, this.layoutSize.width - LABEL_PADDING)), {
                fg,
                bg,
            });
            this.renderChildren(context);
            return;
        }

        const separator = this.separatorColumn;
        // Обрезка по своей колонке: длинная метка не переползает разделитель.
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
