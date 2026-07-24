import { DisplayLine } from "../../../../../../tuidom/common/displayLine.ts";
import type { RenderContext } from "../../../../../../tuidom/dom/tuiElement.ts";
import { ScrollableElement, type ScrollViewportInfo } from "../../../../../../tuidom/ui/scrollbar/scrollableElement.ts";

/** A file-group header row (file path + how many matches it has). */
export interface IFileRow {
    readonly kind: "file";
    readonly label: string;
    /** Mutable: bumped as more matching lines for this file stream in. */
    count: number;
}

/** A single matched line, pre-split so the matched span can be highlighted. */
export interface IMatchRow {
    readonly kind: "match";
    readonly lineNumber: number;
    readonly before: string;
    readonly inside: string;
    readonly after: string;
}

export type SearchRow = IFileRow | IMatchRow;

export interface ISearchResultsStyles {
    /** Default row text. */
    readonly fg: number;
    /** List background. */
    readonly bg: number;
    /** Line numbers and file match-counts. */
    readonly dimFg: number;
    /** The matched span foreground/background (the highlight). */
    readonly matchFg: number;
    readonly matchBg: number;
}

const DEFAULT_STYLES: ISearchResultsStyles = { fg: 0, bg: 0, dimFg: 0, matchFg: 0, matchBg: 0 };

/** Columns a match row is indented under its file header. */
const MATCH_INDENT = 2;
/** Gap between a match's line number and its text. */
const LINE_NUMBER_GAP = 2;

/**
 * Flat, virtualised results list for the Search view: a scrollable column of
 * file-header rows and match rows. Only the visible rows are drawn (rows can run
 * into the thousands), and each match row highlights its matched span. The
 * collapsible file→match tree is a later step — the row model already groups by
 * file so that upgrade is view-only.
 */
export class SearchResultsElement extends ScrollableElement {
    private rows: readonly SearchRow[] = [];
    private styles: ISearchResultsStyles = DEFAULT_STYLES;

    /** Points the list at a rows array. The array may keep growing (streamed results). */
    public setRows(rows: readonly SearchRow[]): void {
        this.rows = rows;
        this.scrollTo(0, 0);
        this.markDirty();
    }

    public setStyles(styles: ISearchResultsStyles): void {
        this.styles = styles;
        this.markDirty();
    }

    public get contentHeight(): number {
        return this.rows.length;
    }

    public get contentWidth(): number {
        // No horizontal scroll: rows clip at the right edge (like VS Code's list).
        return this.layoutSize.width;
    }

    protected renderViewport(context: RenderContext, viewport: ScrollViewportInfo): void {
        const { scrollTop, viewportWidth, viewportHeight } = viewport;
        const { fg, bg, dimFg, matchFg, matchBg } = this.styles;

        for (let screenY = 0; screenY < viewportHeight; screenY++) {
            // Paint the row background first so short rows still fill their line.
            for (let x = 0; x < viewportWidth; x++) {
                context.setCell(x, screenY, { char: " ", fg, bg });
            }

            const row = this.rows[scrollTop + screenY];
            if (row === undefined) continue;

            if (row.kind === "file") {
                const x = this.draw(context, 0, screenY, row.label, fg, bg);
                this.draw(context, x + 2, screenY, String(row.count), dimFg, bg);
            } else {
                let x = this.draw(context, MATCH_INDENT, screenY, String(row.lineNumber), dimFg, bg);
                x = this.draw(context, x + LINE_NUMBER_GAP, screenY, row.before, fg, bg);
                x = this.draw(context, x, screenY, row.inside, matchFg, matchBg);
                this.draw(context, x, screenY, row.after, fg, bg);
            }
        }
    }

    /** Draws one text segment at (x, y) and returns the x just past it. */
    private draw(context: RenderContext, x: number, y: number, text: string, fg: number, bg: number): number {
        if (text.length > 0) context.drawText(x, y, text, { fg, bg });
        return x + new DisplayLine(text).displayWidth;
    }
}
