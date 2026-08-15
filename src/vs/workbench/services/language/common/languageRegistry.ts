import * as path from "node:path";

import type { IDisposable } from "@tuidom/core/common/disposable";
import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILanguageContribution } from "../../../../platform/extensions/common/iLanguageContribution.ts";

/**
 * Запись о зарегистрированном языке. Несколько расширений могут
 * contribute'ить один и тот же `languageId` — мы сливаем их данные
 * (extensions, filenames, aliases) в одну запись.
 */
export interface ILanguageEntry {
    readonly id: string;
    readonly aliases: readonly string[];
    readonly extensions: readonly string[];
    readonly filenames: readonly string[];
    readonly filenamePatterns: readonly string[];
    readonly firstLine: string | undefined;
    readonly mimetypes: readonly string[];
    /** Виртуальный путь к `language-configuration.json`, если есть. */
    readonly configurationPath: string | undefined;
}

interface MutableLanguageEntry {
    id: string;
    aliases: string[];
    extensions: string[];
    filenames: string[];
    filenamePatterns: string[];
    firstLine: string | undefined;
    mimetypes: string[];
    configurationPath: string | undefined;
}

/**
 * Сводный реестр языков из `contributes.languages` всех загруженных
 * расширений. Заменяет старый хардкод `BUILTIN_LANGUAGES` и
 * `getLanguageIdForFile` из `Editor/Tokenization/languageDetection.ts`.
 *
 * Язык, не пришедший ни от одного расширения, в реестре не появится —
 * тогда `getLanguageIdForResource` вернёт `undefined` и потребитель
 * (`EditorComponent.ensureTokenizerForLanguage`) откатится на `plaintext`.
 */
export class LanguageRegistry implements ILanguageService {
    private readonly languages = new Map<string, MutableLanguageEntry>();

    public constructor() {
        // plaintext — core-язык (аналог modesRegistry в VS Code): его не
        // contribute'ит ни один языковой пак, но он всегда должен быть в
        // реестре — как fallback для документов без языка и как запись
        // для будущего пикера. Refcount никогда не опускается до нуля.
        this.applyContribution({ id: "plaintext", aliases: ["Plain Text"], extensions: [".txt"] }, "builtin:core/", 1);
    }

    /**
     * Регистрирует все языки из манифеста расширения.
     * Возвращает Disposable, который удаляет contributions именно этого
     * расширения (для будущей выгрузки расширений). При множественных
     * contribute'ах одного `languageId` запись остаётся, пока хотя бы один
     * источник его удерживает.
     */
    public register(extension: IExtension): IDisposable {
        const langs = extension.manifest.contributes?.languages;
        if (langs === undefined || langs.length === 0) {
            return { dispose: () => undefined };
        }

        const ownContributions: ILanguageContribution[] = [];
        for (const lang of langs) {
            ownContributions.push(lang);
            this.applyContribution(lang, extension.location, 1);
        }

        return {
            dispose: () => {
                for (const lang of ownContributions) {
                    this.applyContribution(lang, extension.location, -1);
                }
            },
        };
    }

    public getLanguage(id: string): ILanguageEntry | undefined {
        const entry = this.languages.get(id);
        if (entry === undefined) return undefined;
        return entry;
    }

    public allLanguages(): readonly ILanguageEntry[] {
        return Array.from(this.languages.values());
    }

    public getLanguageDisplayName(languageId: string): string | undefined {
        return this.languages.get(languageId)?.aliases[0];
    }

    /**
     * Основное расширение языка. Как и у alias'ов — первое заявленное: при
     * нескольких расширениях (`.yml`/`.yaml`) предлагаем то, что расширение
     * назвало первым.
     *
     * Внимание: у dotfile-языков «расширение» — это всё имя файла целиком
     * (`.editorconfig`), так что склеивать результат с именем buffer'а осмысленно
     * не для любого языка. Для безымянных буферов это не стреляет: их язык —
     * `plaintext` (`.txt`), пока его явно не сменят.
     */
    public getExtensionForLanguage(languageId: string): string | undefined {
        return this.languages.get(languageId)?.extensions[0];
    }

    /**
     * Определяет language id по пути к файлу.
     * Порядок матчинга (как в VS Code):
     *   1) точное совпадение `filenames`
     *   2) match по `filenamePatterns` (glob)
     *   3) совпадение `extensions` (case-insensitive)
     */
    public getLanguageIdForResource(filePath: string): string | undefined {
        const baseName = path.basename(filePath);
        const baseNameLower = baseName.toLowerCase();

        for (const entry of this.languages.values()) {
            for (const fn of entry.filenames) {
                if (fn === baseName) return entry.id;
            }
        }

        for (const entry of this.languages.values()) {
            for (const pattern of entry.filenamePatterns) {
                if (matchGlob(pattern, baseNameLower)) return entry.id;
            }
        }

        // При конфликте расширений (несколько языков заявляют один `.ext`)
        // побеждает зарегистрированный ПОЗЖЕ — как в VS Code, где user-расширение
        // грузится после builtin и переопределяет ассоциацию. Пример: и builtin
        // `properties` (ini), и user `editorconfig` заявляют `.editorconfig`;
        // должен выиграть `editorconfig` (стоковый editorconfig-vscode). Поэтому
        // не возвращаем на первом совпадении, а берём последнее.
        const ext = path.extname(baseName).toLowerCase();
        let match: string | undefined;
        for (const entry of this.languages.values()) {
            for (const candidate of entry.extensions) {
                const cand = candidate.toLowerCase();
                // Обычное расширение (foo.ts → ".ts") либо dotfile, чьё имя целиком
                // совпадает с "расширением" (.editorconfig) — у таких `path.extname`
                // пуст, но VS Code матчит их по суффиксу имени.
                if ((ext.length > 0 && cand === ext) || (ext.length === 0 && cand === baseNameLower)) {
                    match = entry.id;
                }
            }
        }
        return match;
    }

    private applyContribution(lang: ILanguageContribution, extensionLocation: string, delta: 1 | -1): void {
        let entry = this.languages.get(lang.id);
        if (entry === undefined) {
            if (delta < 0) return;
            entry = {
                id: lang.id,
                aliases: [],
                extensions: [],
                filenames: [],
                filenamePatterns: [],
                firstLine: undefined,
                mimetypes: [],
                configurationPath: undefined,
            };
            this.languages.set(lang.id, entry);
        }

        mergeStrings(entry.aliases, lang.aliases, delta);
        mergeStrings(entry.extensions, lang.extensions, delta);
        mergeStrings(entry.filenames, lang.filenames, delta);
        mergeStrings(entry.filenamePatterns, lang.filenamePatterns, delta);
        mergeStrings(entry.mimetypes, lang.mimetypes, delta);

        if (delta > 0) {
            if (entry.firstLine === undefined && lang.firstLine !== undefined) {
                entry.firstLine = lang.firstLine;
            }
            if (entry.configurationPath === undefined && lang.configuration !== undefined) {
                entry.configurationPath = joinVirtualPath(extensionLocation, lang.configuration);
            }
        }
        // Замечание: при unregister мы оставляем firstLine/configurationPath как есть —
        // снимется при удалении пустой записи ниже. Это упрощение, достаточное для Phase 1.

        if (
            delta < 0 &&
            entry.aliases.length === 0 &&
            entry.extensions.length === 0 &&
            entry.filenames.length === 0 &&
            entry.filenamePatterns.length === 0 &&
            entry.mimetypes.length === 0
        ) {
            this.languages.delete(lang.id);
        }
    }
}

function mergeStrings(target: string[], source: readonly string[] | undefined, delta: 1 | -1): void {
    if (source === undefined) return;
    if (delta > 0) {
        for (const value of source) target.push(value);
    } else {
        for (const value of source) {
            const idx = target.indexOf(value);
            if (idx !== -1) target.splice(idx, 1);
        }
    }
}

/**
 * Минимальный glob-matcher для `filenamePatterns`. Поддерживает `*` (любая
 * последовательность символов) и `?` (один символ). Этого достаточно для
 * паттернов из реальных VS Code-расширений (например `tsconfig.*.json`).
 * Полный bracket/extglob-поддержки не требуется.
 */
function matchGlob(pattern: string, lowerName: string): boolean {
    const lowerPattern = pattern.toLowerCase();
    let regexSource = "^";
    for (const ch of lowerPattern) {
        if (ch === "*") regexSource += ".*";
        else if (ch === "?") regexSource += ".";
        else regexSource += escapeRegex(ch);
    }
    regexSource += "$";
    return new RegExp(regexSource).test(lowerName);
}

function escapeRegex(ch: string): string {
    return /[.\\+^$|()[\]{}/]/.test(ch) ? `\\${ch}` : ch;
}
