import { token } from "../../instantiation/common/diContainer.ts";

export interface IClipboard {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string inside is only a debug label
export const ClipboardDIToken = token<IClipboard>("Clipboard");
