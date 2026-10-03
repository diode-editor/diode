import { token } from "../../../platform/instantiation/common/diContainer.ts";

/**
 * Сервис определения language id по пути к файлу.
 *
 * Реализуется в `Extensions/LanguageRegistry`. Editor/Workbench зависят
 * только от этого интерфейса — это та же дисциплина, что и с
 * {@link ITokenStyleResolver}: тип живёт здесь, реализация — в верхних
 * слоях. Никаких прямых импортов `Extensions/*` из Editor/Workbench.
 */
export interface ILanguageService {
    /**
     * Возвращает language id для данного абсолютного или относительного
     * пути к файлу, либо `undefined`, если язык не зарегистрирован
     * (потребитель тогда обычно откатывается на `"plaintext"`).
     */
    getLanguageIdForResource(filePath: string): string | undefined;

    /**
     * Человекочитаемое имя языка для UI (конвенция VS Code: первый alias
     * из `contributes.languages`, например `"TypeScript"` для
     * `typescript`). `undefined`, если язык не зарегистрирован или без
     * alias'ов — потребитель откатывается на сырой language id.
     */
    getLanguageDisplayName(languageId: string): string | undefined;

    /**
     * Основное расширение языка вместе с точкой (`".ts"` для `typescript`) —
     * обратная операция к {@link getLanguageIdForResource}. Конвенция та же, что
     * у alias'ов: первое из `contributes.languages`. `undefined`, если язык не
     * зарегистрирован или не заявил ни одного расширения.
     *
     * Нужно там, где имя файла надо предложить, а не разобрать: Save As
     * безымянного буфера отталкивается от его языка (`plaintext` → `.txt`).
     */
    getExtensionForLanguage(languageId: string): string | undefined;
}

/**
 * Заглушка для случаев, когда `ILanguageService` ещё не подключён
 * (тесты, ранний bootstrap). Всегда возвращает `undefined`.
 */
export const NULL_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => undefined,
    getLanguageDisplayName: () => undefined,
    getExtensionForLanguage: () => undefined,
};

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const LanguageServiceDIToken = token<ILanguageService>("LanguageService");
