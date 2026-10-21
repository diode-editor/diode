import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { RenderContext, TUIElement } from "@tuidom/core/dom/tuiElement";

const COLUMN_SEPARATOR = "│";

const LABEL_PADDING = 1;

/**
 * A module constant, not a static class field: a static self-reference makes esbuild
 * rename the class (`class _X`), which blinds e2e selectors that match on `constructor.name`.
 */
export const DIFF_HEADER_ROWS = 1;

/**
 * Counterpart of `diffEditor.renderSideBySideInlineBreakpoint`. The threshold is the width of the
 * ELEMENT ITSELF, not the terminal: a terminal-based threshold kept inline mode even at 140 columns.
 */
export const SIDE_BY_SIDE_MIN_COLS = 100;

/** Hysteresis: width jitter (sidebar, scrollbar) does not flip the mode back and forth. */
const SIDE_BY_SIDE_EXIT_COLS = SIDE_BY_SIDE_MIN_COLS + 4;

export type DiffPaneMode = "side-by-side" | "inline";

export type DiffPaneModeOverride = "auto" | DiffPaneMode;

/**
 * Reports mode changes from layout; the owner re-lays out zones DEFERRED — changing zones
 * right inside layout would leave the root layout-dirty after the frame (dirty gate).
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
        // The width is known before layout — apply right away so the owner re-lays out
        // zones synchronously with the command.
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
        // Clip to its own column: a long label must not run over the separator.
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
