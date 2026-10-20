import type { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";

/**
 * Снапшот документа, передаваемый save-участнику (`onWillSaveTextDocument`)
 * перед записью на диск. Текст — LF-канонический (как хранит {@link TextDocument}),
 * EOL применяется отдельным эдитом (`kind: "eol"`).
 */
export interface ISaveSnapshot {
    /**
     * Ресурс сохраняемого документа как `uri.toString()`. Не путь: участник живёт за
     * RPC, где документ адресуется ресурсом (`document.fileName` субпроцесс выводит
     * из него сам, как того требует vscode.d.ts).
     */
    readonly uri: string;
    readonly languageId: string;
    readonly versionId: number;
    readonly isDirty: boolean;
    /**
     * Полный текст документа (LF-канонический). Ленивый: строится при чтении,
     * из документа на этот момент — участник, которому он не нужен, за него не
     * платит.
     */
    readonly text: string;
    /**
     * Текущий EOL документа (детектированный при загрузке / изменённый ранее).
     * Нужен участнику, чтобы решить, менять ли перевод строки: стоковый
     * editorconfig-vscode эмитит `setEndOfLine` только когда `doc.eol` отличается
     * от целевого (иначе no-op, сохраняя redo-историю).
     */
    readonly eol: EndOfLine;
    /**
     * Кодировка, в которой документ будет записан на диск (id из
     * SUPPORTED_ENCODINGS, см. Encoding.ts). Только для чтения участником:
     * менять кодировку через will-save нельзя (как в VS Code — у TextEdit нет
     * encoding-варианта), поэтому парного вида ISaveEdit нет.
     */
    readonly encoding: string;
}

/**
 * Правка, возвращаемая save-участником. Либо замена текста в диапазоне
 * (`kind: "text"`, координаты 0-based), либо смена EOL всего документа
 * (`kind: "eol"`).
 */
export type ISaveEdit =
    | { readonly kind: "text"; readonly range: IRange; readonly text: string }
    | { readonly kind: "eol"; readonly eol: EndOfLine };

/**
 * Save-участник: по снапшоту документа возвращает набор правок, которые
 * редактор применяет к буферу (undoable) непосредственно перед записью на диск.
 * Инъектируется в модель файла (`TextFileModel`) извне (host/харнесс) — ядро не знает
 * про extension-слой. Пустой результат = сохранить как есть.
 */
export type SaveParticipant = (snapshot: ISaveSnapshot) => Promise<readonly ISaveEdit[]>;
