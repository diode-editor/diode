/**
 * Description of a single content change applied to {@link ITextDocument}.
 *
 * Coordinates are in *pre-edit* logical line space. After the change, the
 * logical line range `[startLine .. oldEndLine]` is replaced with new content
 * spanning `[startLine .. newEndLine]`. `lineDelta = newEndLine - oldEndLine`.
 *
 * Token caches and similar derived data live outside the document and listen
 * to these events to invalidate / shift their entries (see DocumentTokenStore).
 */
export interface IDocumentContentChange {
    readonly startLine: number;
    readonly oldEndLine: number;
    readonly newEndLine: number;
    /**
     * Содержимое заменено целиком ({@link ITextDocument.setText}: перечитка с
     * диска, смена содержимого владельцем) — upstream `isFlush`. Документ тот
     * же, но всё, что выводилось из прежнего текста (детект отступа, фолды),
     * пора вывести заново.
     */
    readonly isFlush?: boolean;
}
