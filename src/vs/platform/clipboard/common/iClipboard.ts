import { token } from "../../instantiation/common/diContainer.ts";

export interface IClipboard {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ClipboardDIToken = token<IClipboard>("Clipboard");
