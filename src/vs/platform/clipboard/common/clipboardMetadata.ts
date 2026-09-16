/** Метаданные последнего текста, ушедшего в буфер через Copy/Cut редактора. */
export interface IClipboardTextMetadata {
    /**
     * Текст скопирован единственным ПУСТЫМ выделением (вся строка целиком,
     * `editor.emptySelectionClipboard`) — маркер линейной вставки: paste кладёт
     * такую строку строкой выше курсорной, а не в позицию каретки.
     */
    readonly isFromEmptySelection: boolean;
}

/**
 * Память о происхождении содержимого буфера обмена — перенос
 * `InMemoryClipboardMetadataManager` из VS Code. Системный буфер несёт голый
 * текст, поэтому метаданные последней записи живут сбоку и выдаются только
 * при точном совпадении текста: изменился буфер снаружи — метаданные молча
 * устаревают. Синглтон, как и в VS Code: копирование и вставка — разные
 * команды, а буфер у приложения один.
 */
export class InMemoryClipboardMetadataManager {
    private lastCopiedText: string | null = null;
    private metadata: IClipboardTextMetadata | null = null;

    public set(text: string, metadata: IClipboardTextMetadata): void {
        this.lastCopiedText = text;
        this.metadata = metadata;
    }

    /** Метаданные, если `text` — ровно последняя записанная строка; иначе `null`. */
    public get(text: string): IClipboardTextMetadata | null {
        return this.lastCopiedText === text ? this.metadata : null;
    }
}

export const inMemoryClipboardMetadata = new InMemoryClipboardMetadataManager();
