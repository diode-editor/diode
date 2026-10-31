import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";

export interface ILanguageService {
    /** `undefined`: no registered language (callers usually fall back to `"plaintext"`). */
    getLanguageIdForResource(filePath: string): string | undefined;

    /** VS Code convention: the first alias from `contributes.languages`. */
    getLanguageDisplayName(languageId: string): string | undefined;

    /** With the dot (`".ts"`); the first one from `contributes.languages`. */
    getExtensionForLanguage(languageId: string): string | undefined;

    /** `plaintext` included: it exists without any contribution, as upstream. */
    getRegisteredLanguageIds(): readonly string[];

    /**
     * Like vscode `requestRichLanguageFeatures` (activation on `onLanguage:<id>`).
     * Fires once per language for the lifetime of the window.
     */
    requestLanguageFeatures(languageId: string): void;

    onDidRequestLanguageFeatures(listener: (languageId: string) => void): IDisposable;
}

export const NULL_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => undefined,
    getLanguageDisplayName: () => undefined,
    getExtensionForLanguage: () => undefined,
    getRegisteredLanguageIds: () => ["plaintext"],
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by its reference; the string is only a debug label
export const LanguageServiceDIToken = token<ILanguageService>("LanguageService");
