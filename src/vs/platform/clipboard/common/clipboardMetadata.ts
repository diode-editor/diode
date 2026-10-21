export interface IClipboardTextMetadata {
    /** Line-paste marker: paste inserts the text as a line above the cursor line, not at the cursor position. */
    readonly isFromEmptySelection: boolean;
}

/** Metadata is returned only on an exact text match: an externally changed clipboard silently invalidates it. */
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
