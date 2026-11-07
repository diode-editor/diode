import { assertReturnsDefined } from "../../../base/common/assert.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange, isEmptyRange } from "../core/iRange.ts";
import type { IGlyphMarginDecoration } from "../model/iGlyphMarginDecoration.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";
import { TrackedRangeStickiness } from "../model/trackedDecorations.ts";

interface IGlyphEntry {
    readonly id: string;
    readonly decoration: IGlyphMarginDecoration;
    /** Its line was the empty last line when it was placed: emptiness says nothing about a deletion then. */
    readonly placedEmpty: boolean;
}

/**
 * The glyph lane's decorations as tracked document decorations (upstream: the model's decorations with
 * `glyphMarginClassName`): a glyph rides its line through edits until the owner places it elsewhere. The tracked
 * range is the whole line with its line break, so deleting the line collapses it — and the glyph is gone.
 */
export class GlyphMarginDecorations {
    private entries: readonly IGlyphEntry[] = [];

    public constructor(private readonly document: ITextDocument) {}

    public get isEmpty(): boolean {
        return this.entries.length === 0;
    }

    /** A glyph with the key and the line of one already placed keeps the line it moved to; the rest are placed anew. */
    public set(decorations: readonly IGlyphMarginDecoration[]): void {
        const previous = new Map(this.entries.map((entry) => [entry.decoration.key, entry]));
        const kept = (decoration: IGlyphMarginDecoration): IGlyphEntry | undefined => {
            const old = previous.get(decoration.key);
            return old?.decoration.line === decoration.line ? old : undefined;
        };
        const keptIds = new Set(
            decorations
                .map(kept)
                .filter((entry) => entry !== undefined)
                .map((entry) => entry.id),
        );
        const placed = decorations.filter((decoration) => kept(decoration) === undefined);
        const ids = this.document.deltaDecorations(
            this.entries.filter((entry) => !keptIds.has(entry.id)).map((entry) => entry.id),
            placed.map((decoration) => ({
                range: this.lineRange(decoration.line),
                options: {
                    // Stryker disable next-line StringLiteral: the description is for debugging only, as in upstream
                    description: "glyph-margin",
                    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            })),
        );
        let next = 0;
        this.entries = decorations.map((decoration) => {
            const old = kept(decoration);
            if (old !== undefined) return { ...old, decoration };
            const id = ids[next++];
            return { id, decoration, placedEmpty: isEmptyRange(this.rangeOf(id)) };
        });
    }

    /** The glyphs by the line they are on now; a deleted line's glyph is not there, the last one on a line wins. */
    public byLine(): Map<number, IGlyphMarginDecoration> {
        const result = new Map<number, IGlyphMarginDecoration>();
        for (const { id, decoration, placedEmpty } of this.entries) {
            const range = this.rangeOf(id);
            if (!placedEmpty && isEmptyRange(range)) continue;
            result.set(range.start.line, decoration);
        }
        return result;
    }

    /** Past the end of the document the document clamps the range to its last line, as upstream validates it. */
    private lineRange(line: number): IRange {
        return line + 1 < this.document.lineCount
            ? createRange(line, 0, line + 1, 0)
            : createRange(line, 0, line, Infinity);
    }

    private rangeOf(id: string): IRange {
        // Only this class removes its decorations.
        return assertReturnsDefined(this.document.getDecorationRange(id));
    }
}
