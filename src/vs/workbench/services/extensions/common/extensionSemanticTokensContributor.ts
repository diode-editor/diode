import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILogger } from "../../../../platform/log/common/iLogger.ts";
import {
    type TokenClassificationRegistry,
    TYPE_AND_MODIFIER_ID_PATTERN,
} from "../../../../platform/theme/common/tokenClassificationRegistry.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Проверка типа/модификатора — `validateTypeOrModifier` эталона, тексты
 * ошибок дословно.
 */
function validateTypeOrModifier(
    contribution: unknown,
    extensionPoint: string,
    error: (message: string) => void,
): contribution is { id: string; description: string; superType?: string } {
    if (!isRecord(contribution) || typeof contribution.id !== "string" || contribution.id.length === 0) {
        error(`'configuration.${extensionPoint}.id' must be defined and can not be empty`);
        return false;
    }
    if (!TYPE_AND_MODIFIER_ID_PATTERN.test(contribution.id)) {
        error(`'configuration.${extensionPoint}.id' must follow the pattern letterOrDigit[-_letterOrDigit]*`);
        return false;
    }
    const superType = contribution.superType;
    if (superType !== undefined && (typeof superType !== "string" || !TYPE_AND_MODIFIER_ID_PATTERN.test(superType))) {
        error(`'configuration.${extensionPoint}.superType' must follow the pattern letterOrDigit[-_letterOrDigit]*`);
        return false;
    }
    if (typeof contribution.description !== "string") {
        error(`'configuration.${extensionPoint}.description' must be defined and can not be empty`);
        return false;
    }
    return true;
}

/**
 * Применяет `contributes.semanticTokenTypes`, `semanticTokenModifiers` и
 * `semanticTokenScopes` всех расширений к {@link TokenClassificationRegistry}
 * — аналог `TokenClassificationExtensionPoints` эталона
 * (`tokenClassificationExtensionPoint.ts`), с теми же проверками и текстами.
 *
 * Регистрация разовая, на старте, в порядке расширений (встроенные →
 * пользовательские): установка расширения требует перезапуска, как и для
 * `contributes.configuration`. Ошибка — строка в лог с id расширения и
 * пропуск элемента; старт не падает.
 *
 * `semanticTokenScopes`: каждая строка массива — отдельная проба, пробелы в ней
 * — путь скоупов (`"meta.decorator entity.name"`); `language` — язык
 * селектора (вес `+10`). Так у redhat.java Java-аннотация (`annotation`,
 * `superType: type`) красится цветом `storage.type.annotation.java`, а не
 * дефолтом типа.
 */
export function registerExtensionSemanticTokens(
    extensions: readonly IExtension[],
    registry: TokenClassificationRegistry,
    logger?: ILogger,
): void {
    for (const ext of extensions) {
        const contributes = ext.manifest.contributes;
        if (contributes === undefined) continue;
        const error = (message: string): void => {
            logger?.error(`${ext.id}: ${message}`);
        };

        const types = contributes.semanticTokenTypes;
        if (types !== undefined) {
            if (Array.isArray(types)) {
                for (const contribution of types as unknown[]) {
                    if (validateTypeOrModifier(contribution, "semanticTokenType", error)) {
                        registry.registerTokenType(contribution.id, contribution.description, contribution.superType);
                    }
                }
            } else {
                error("'configuration.semanticTokenType' must be an array");
            }
        }

        const modifiers = contributes.semanticTokenModifiers;
        if (modifiers !== undefined) {
            if (Array.isArray(modifiers)) {
                for (const contribution of modifiers as unknown[]) {
                    if (validateTypeOrModifier(contribution, "semanticTokenModifier", error)) {
                        registry.registerTokenModifier(contribution.id, contribution.description);
                    }
                }
            } else {
                error("'configuration.semanticTokenModifier' must be an array");
            }
        }

        const scopes = contributes.semanticTokenScopes;
        if (scopes !== undefined) {
            if (Array.isArray(scopes)) {
                for (const contribution of scopes as unknown[]) {
                    registerScopes(contribution, registry, error);
                }
            } else {
                error("'configuration.semanticTokenScopes' must be an array");
            }
        }
    }
}

function registerScopes(
    contribution: unknown,
    registry: TokenClassificationRegistry,
    error: (message: string) => void,
): void {
    const language = isRecord(contribution) ? contribution.language : undefined;
    if (language !== undefined && typeof language !== "string") {
        error("'configuration.semanticTokenScopes.language' must be a string");
        return;
    }
    const scopes = isRecord(contribution) ? contribution.scopes : undefined;
    if (!isRecord(scopes)) {
        error("'configuration.semanticTokenScopes.scopes' must be defined as an object");
        return;
    }
    for (const [selectorString, tmScopes] of Object.entries(scopes)) {
        if (!Array.isArray(tmScopes) || (tmScopes as unknown[]).some((l) => typeof l !== "string")) {
            error("'configuration.semanticTokenScopes.scopes' values must be an array of strings");
            continue;
        }
        registry.registerTokenStyleDefault(registry.parseTokenSelector(selectorString, language), {
            scopesToProbe: (tmScopes as string[]).map((s) => s.split(" ")),
        });
    }
}
