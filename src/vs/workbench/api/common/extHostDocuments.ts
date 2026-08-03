import { EndOfLine, Position, Range, Uri } from "./vscodeTypes.ts";

/**
 * Реестр документов на стороне subprocess со СТАБИЛЬНОЙ идентичностью.
 *
 * editorconfig сравнивает документы по ссылке (`activeTextEditor.document ===
 * doc`), поэтому на один ресурс должен приходиться ровно один
 * {@link ExtHostTextDocument}, живущий весь жизненный цикл сессии.
 * Обновления метаданных/текста мутируют существующий объект, а не создают новый.
 *
 * Полные снапшоты текста приходят только на пути will-save (WP6); до тех пор
 * текст — пустая строка, а `lineAt`/`lineCount` отражают последний снапшот.
 */

/** Метаданные документа (путь active-editor-change; без текста). */
export interface ExtHostDocumentMeta {
    /** Ресурс документа как `uri.toString()` — идентичность, из неё выводится `fileName`. */
    readonly uri: string;
    readonly languageId?: string;
    readonly isDirty?: boolean;
    /** Кодировка дискового представления (id вида "utf8"/"windows1251"). */
    readonly encoding?: string;
    /** Текущий EOL документа (`vscode.EndOfLine`: 1=LF, 2=CRLF). */
    readonly eol?: EndOfLine;
}

/** Полный снапшот документа (пути will-save и document sync; с текстом). */
export interface ExtHostDocumentSnapshot extends ExtHostDocumentMeta {
    readonly text: string;
    /**
     * Явная версия ядрового документа (путь document sync). LSP требует
     * монотонной версии per-document, поэтому host передаёт `versionId` модели;
     * без неё версия инкрементируется локально (путь will-save).
     */
    readonly version?: number;
}

/** Строка документа (`vscode.TextLine`). */
export interface TextLine {
    readonly lineNumber: number;
    readonly text: string;
    readonly range: Range;
    readonly rangeIncludingLineBreak: Range;
    readonly firstNonWhitespaceCharacterIndex: number;
    readonly isEmptyOrWhitespace: boolean;
}

/** Стабильный объект документа. Идентичность сохраняется между upsert'ами. */
export class ExtHostTextDocument {
    /** Идентичность ресурса — источник правды, как в `vscode.TextDocument.uri`. */
    public readonly uri: Uri;
    public readonly isClosed = false;

    /** Отражает кодировку ядрового документа: обновляется из меты/снапшотов. */
    public encoding = "utf8";

    /**
     * Путь ресурса на ФС. По спецификации (`vscode.d.ts`) это shorthand для
     * `uri.fsPath`, «independent of the uri scheme» — то есть производное от uri,
     * а не наоборот.
     */
    public get fileName(): string {
        return this.uri.fsPath;
    }

    /** Безымянный буфер — это схема `untitled:`, а не отдельный флаг. */
    public get isUntitled(): boolean {
        return this.uri.scheme === "untitled";
    }

    /** Отражает EOL ядрового документа: обновляется из меты/снапшотов. */
    public eol: EndOfLine = EndOfLine.LF;

    public languageId = "plaintext";
    public isDirty = false;
    public version = 0;

    private text = "";
    private lineCache: string[] | null = null;

    public constructor(uri: Uri) {
        this.uri = uri;
    }

    /** Обновляет метаданные без смены текста/версии (active-editor-change). */
    public applyMeta(meta: ExtHostDocumentMeta): void {
        if (meta.languageId !== undefined) this.languageId = meta.languageId;
        if (meta.isDirty !== undefined) this.isDirty = meta.isDirty;
        if (meta.encoding !== undefined) this.encoding = meta.encoding;
        if (meta.eol !== undefined) this.eol = meta.eol;
    }

    /**
     * Обновляет текст + метаданные. Версия — явная из снапшота (document sync,
     * `versionId` модели побеждает локальный счётчик) либо инкремент (will-save).
     */
    public applyFull(snapshot: ExtHostDocumentSnapshot): void {
        this.applyMeta(snapshot);
        this.text = snapshot.text;
        this.lineCache = null;
        this.version = snapshot.version ?? this.version + 1;
    }

    public getText(range?: Range): string {
        if (range === undefined) return this.text;
        const lines = this.lines();
        if (range.start.line === range.end.line) {
            return lines[range.start.line].slice(range.start.character, range.end.character);
        }
        const parts: string[] = [lines[range.start.line].slice(range.start.character)];
        for (let n = range.start.line + 1; n < range.end.line; n++) {
            parts.push(lines[n]);
        }
        parts.push(lines[range.end.line].slice(0, range.end.character));
        return parts.join("\n");
    }

    public get lineCount(): number {
        return this.lines().length;
    }

    public lineAt(lineOrPosition: number | Position): TextLine {
        const lineNumber = typeof lineOrPosition === "number" ? lineOrPosition : lineOrPosition.line;
        const lines = this.lines();
        if (lineNumber < 0 || lineNumber >= lines.length) {
            throw new RangeError(`Illegal line number ${lineNumber} (lineCount=${lines.length})`);
        }
        const text = lines[lineNumber];
        const firstNonWhitespaceCharacterIndex = firstNonWhitespace(text);
        const isLast = lineNumber === lines.length - 1;
        return {
            lineNumber,
            text,
            range: new Range(lineNumber, 0, lineNumber, text.length),
            rangeIncludingLineBreak: isLast
                ? new Range(lineNumber, 0, lineNumber, text.length)
                : new Range(lineNumber, 0, lineNumber + 1, 0),
            firstNonWhitespaceCharacterIndex,
            isEmptyOrWhitespace: firstNonWhitespaceCharacterIndex === text.length,
        };
    }

    private lines(): string[] {
        this.lineCache ??= this.text.split("\n");
        return this.lineCache;
    }
}

/** Индекс первого не-whitespace символа; длина строки, если вся whitespace. */
function firstNonWhitespace(text: string): number {
    for (let i = 0; i < text.length; i++) {
        if (!/\s/.test(text[i])) return i;
    }
    return text.length;
}

/**
 * Реестр `Map<uri.toString(), ExtHostTextDocument>` со стабильной идентичностью.
 * Ключ — ресурс, а не путь: путь у не-file схем неоднозначен, а `Map` всё равно
 * сравнивает только строки.
 */
export class DocumentRegistry {
    private readonly documents = new Map<string, ExtHostTextDocument>();

    public get(uri: Uri): ExtHostTextDocument | undefined {
        return this.documents.get(uri.toString());
    }

    /** Лениво создаёт стабильный документ (нужен ДО прихода снапшота). */
    public getOrCreate(uri: Uri): ExtHostTextDocument {
        const key = uri.toString();
        let doc = this.documents.get(key);
        if (doc === undefined) {
            doc = new ExtHostTextDocument(uri);
            this.documents.set(key, doc);
        }
        return doc;
    }

    public upsertMeta(meta: ExtHostDocumentMeta): ExtHostTextDocument {
        const doc = this.getOrCreate(Uri.parse(meta.uri));
        doc.applyMeta(meta);
        return doc;
    }

    public upsertFull(snapshot: ExtHostDocumentSnapshot): ExtHostTextDocument {
        const doc = this.getOrCreate(Uri.parse(snapshot.uri));
        doc.applyFull(snapshot);
        return doc;
    }

    /** Все известные документы (задел под `workspace.textDocuments`, WP3). */
    public all(): ExtHostTextDocument[] {
        return [...this.documents.values()];
    }
}
