import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";

/** Text is LF-canonical; EOL is applied by a separate edit (`kind: "eol"`). */
export interface ISaveSnapshot {
    /** Not a path: across RPC the document is addressed by resource, the subprocess derives `document.fileName` itself. */
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
    readonly isDirty: boolean;
    /** Lazy: a participant that does not need the text does not pay for it. */
    readonly text: string;
    /**
     * The stock editorconfig-vscode emits `setEndOfLine` only when `doc.eol` differs
     * from the target.
     */
    readonly eol: EndOfLine;
    /** Read-only: TextEdit has no encoding variant (as in VS Code), so there is no matching ISaveEdit. */
    readonly encoding: string;
}

/** `kind: "text"` coordinates are 0-based. */
export type ISaveEdit =
    | { readonly kind: "text"; readonly range: IRange; readonly text: string }
    | { readonly kind: "eol"; readonly eol: EndOfLine };

/** Edits are applied as undoable right before the write; an empty result means save as is. */
export type SaveParticipant = (snapshot: ISaveSnapshot) => Promise<readonly ISaveEdit[]>;
