export interface IClipboardTextMetadata {
    /** Маркер линейной вставки: paste кладёт строку строкой выше курсорной, а не в позицию каретки. */
    readonly isFromEmptySelection: boolean;
}

/** Метаданные выдаются только при точном совпадении текста: буфер, изменённый снаружи, их молча гасит. */
export class InMemoryClipboardMetadataManager {
    private lastCopiedText: string | null = null;
    private metadata: IClipboardTextMetadata | null = null;

    public set(text: string, metadata: IClipboardTextMetadata): void {
        this.lastCopiedText = text;
        this.metadata = metadata;
    }

    public get(text: string): IClipboardTextMetadata | null {
        return this.lastCopiedText === text ? this.metadata : null;
    }
}

export const inMemoryClipboardMetadata = new InMemoryClipboardMetadataManager();
