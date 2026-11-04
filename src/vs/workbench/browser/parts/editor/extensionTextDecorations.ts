import { assertReturnsDefined } from "../../../../base/common/assert.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type {
    IExtensionDecorationAttachment,
    IExtensionTextDecoration,
    IExtensionTextDecorationSet,
} from "../../../../editor/common/model/iExtensionTextDecoration.ts";
import type { IInlineInsertion } from "../../../../editor/common/model/iInlineInsertion.ts";
import type { ITextDocument } from "../../../../editor/common/model/iTextDocument.ts";
import { COLOR_DECORATOR_TEXT } from "../../../../editor/contrib/colorPicker/browser/colorDetector.ts";
import { hintLeadsText } from "../../../../editor/contrib/inlayHints/browser/inlayHintsController.ts";

interface ITypeSet {
    readonly ids: readonly string[];
    readonly decorations: readonly IExtensionTextDecoration[];
}

/**
 * Extension decoration types of one editor: each range is a tracked document decoration with the type's
 * stickiness, so between two `setDecorations` the paint and the `before`/`after` cells follow the text. Upstream
 * keeps a range collapsed by an edit, too: only the extension's next set removes it.
 */
export class ExtensionTextDecorations extends Disposable {
    private readonly types = new Map<number, ITypeSet>();

    public constructor(
        private readonly document: ITextDocument,
        private readonly onDidChange: (
            paint: readonly IExtensionTextDecoration[],
            insertions: readonly IInlineInsertion[],
        ) => void,
    ) {
        super();
        // The document moves the decorations before its events: the cells follow the text at once.
        this.register(
            document.onDidChangeModelContent(() => {
                this.publish();
            }),
        );
        this.register({
            dispose: () => {
                for (const { ids } of this.types.values()) document.deltaDecorations(ids, []);
            },
        });
    }

    public set({ key, decorations, restyle }: IExtensionTextDecorationSet): void {
        const previous = this.types.get(key);
        if (restyle === true && previous?.decorations.length === decorations.length) {
            this.types.set(key, { ids: previous.ids, decorations });
        } else {
            const ids = this.document.deltaDecorations(
                // Stryker disable next-line ArrayDeclaration: deltaDecorations ignores an id it does not hold
                previous?.ids ?? [],
                decorations.map((decoration) => ({
                    range: decoration.range,
                    // Stryker disable next-line ObjectLiteral,StringLiteral: the description only names the decoration in a debugger
                    options: { description: "extensionTextDecoration", stickiness: decoration.stickiness },
                })),
            );
            this.types.set(key, { ids, decorations });
        }
        this.publish();
    }

    /**
     * Types in key (creation) order. At one offset the insertions keep that order, a `before` ahead of an
     * `after` of the same empty range.
     */
    private publish(): void {
        const paint: IExtensionTextDecoration[] = [];
        // Stryker disable next-line ArrayDeclaration: an entry without a line belongs to no line and is never painted
        const insertions: IInlineInsertion[] = [];
        for (const [, { ids, decorations }] of [...this.types].sort(([a], [b]) => a - b)) {
            decorations.forEach((decoration, i) => {
                // Our ids live until we remove them.
                const range = assertReturnsDefined(this.document.getDecorationRange(ids[i]));
                // A Tailwind-sized set of swatches would cost the frame a pass per range that paints nothing.
                // Stryker disable next-line ConditionalExpression,EqualityOperator: performance only — a range without colors paints nothing
                if (decoration.bg !== undefined || decoration.fg !== undefined) paint.push({ ...decoration, range });
                const { isWholeLine, before, after } = decoration;
                if (before !== undefined) {
                    const at = isWholeLine ? { line: range.start.line, character: 0 } : range.start;
                    this.pushAttachment(insertions, before, at, true);
                }
                if (after !== undefined) {
                    const line = range.end.line;
                    const at = isWholeLine ? { line, character: this.document.getLineLength(line) } : range.end;
                    this.pushAttachment(insertions, after, at, false);
                }
            });
        }
        this.onDidChange(paint, insertions);
    }

    /**
     * A swatch is `ColorDetector`'s square. Text keeps its cells out of selections and find matches, like an
     * inlay hint; a `before` that leads the text after it lets the block caret stand on that text (`hintLeadsText`).
     */
    private pushAttachment(
        insertions: IInlineInsertion[],
        attachment: IExtensionDecorationAttachment,
        { line, character: offset }: IPosition,
        before: boolean,
    ): void {
        if (attachment.kind === "swatch") {
            insertions.push({ line, offset, text: COLOR_DECORATOR_TEXT, fg: attachment.color, caretSide: "right" });
            return;
        }
        const leads = before && hintLeadsText(this.document.getLineContent(line), offset);
        insertions.push({
            line,
            offset,
            text: attachment.text,
            fg: attachment.fg,
            bg: attachment.bg,
            italic: attachment.italic,
            outsideRangeBackgrounds: true,
            ...(leads ? { caretSide: "right" } : {}),
        });
    }
}
