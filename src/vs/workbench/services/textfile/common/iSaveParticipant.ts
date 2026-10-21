import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";

/** Текст LF-канонический; EOL применяется отдельным эдитом (`kind: "eol"`). */
export interface ISaveSnapshot {
    /** Не путь: за RPC документ адресуется ресурсом, `document.fileName` субпроцесс выводит сам. */
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
    readonly isDirty: boolean;
    /** Ленивый: участник, которому текст не нужен, за него не платит. */
    readonly text: string;
    /**
     * Стоковый editorconfig-vscode эмитит `setEndOfLine`, только когда `doc.eol`
     * отличается от целевого.
     */
    readonly eol: EndOfLine;
    /** Только для чтения: у TextEdit нет encoding-варианта (как в VS Code), парного ISaveEdit нет. */
    readonly encoding: string;
}

/** `kind: "text"` — координаты 0-based. */
export type ISaveEdit =
    | { readonly kind: "text"; readonly range: IRange; readonly text: string }
    | { readonly kind: "eol"; readonly eol: EndOfLine };

/** Правки применяются undoable прямо перед записью; пустой результат — сохранить как есть. */
export type SaveParticipant = (snapshot: ISaveSnapshot) => Promise<readonly ISaveEdit[]>;
