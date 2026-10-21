import type { IDisposable } from "../../../base/common/lifecycle.ts";
import { token } from "../../../platform/instantiation/common/diContainer.ts";

export interface ILanguageService {
    /** `undefined` — язык не зарегистрирован (потребитель обычно берёт `"plaintext"`). */
    getLanguageIdForResource(filePath: string): string | undefined;

    /** Конвенция VS Code: первый alias из `contributes.languages`. */
    getLanguageDisplayName(languageId: string): string | undefined;

    /** С точкой (`".ts"`); первое из `contributes.languages`. */
    getExtensionForLanguage(languageId: string): string | undefined;

    /**
     * Аналог `requestRichLanguageFeatures` у vscode (активация по
     * `onLanguage:<id>`). Сигнал один на язык за жизнь окна.
     */
    requestLanguageFeatures(languageId: string): void;

    onDidRequestLanguageFeatures(listener: (languageId: string) => void): IDisposable;
}

export const NULL_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => undefined,
    getLanguageDisplayName: () => undefined,
    getExtensionForLanguage: () => undefined,
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const LanguageServiceDIToken = token<ILanguageService>("LanguageService");
