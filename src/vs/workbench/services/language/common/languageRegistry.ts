import * as path from "node:path";

import { joinVirtualPath } from "../../../../base/common/assets/assetBundleFormat.ts";
import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";
import type { ILanguageContribution } from "../../../../platform/extensions/common/iLanguageContribution.ts";

/** Several extensions may contribute the same `languageId`; their data merges into one entry. */
export interface ILanguageEntry {
    readonly id: string;
    readonly aliases: readonly string[];
    readonly extensions: readonly string[];
    readonly filenames: readonly string[];
    readonly filenamePatterns: readonly string[];
    readonly firstLine: string | undefined;
    readonly mimetypes: readonly string[];
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

export class LanguageRegistry implements ILanguageService {
    private readonly languages = new Map<string, MutableLanguageEntry>();
    private readonly requestedLanguages = new Set<string>();
    private readonly onDidRequestLanguageFeaturesEmitter = new Emitter<string>();

    public constructor() {
        // No pack contributes plaintext (VS Code's modesRegistry counterpart), but it is needed as a fallback;
        // the refcount never drops to zero.
        this.applyContribution({ id: "plaintext", aliases: ["Plain Text"], extensions: [".txt"] }, "builtin:core/", 1);
    }

    /** A language entry lives while at least one source holds it. */
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

    public requestLanguageFeatures(languageId: string): void {
        if (this.requestedLanguages.has(languageId)) return;
        this.requestedLanguages.add(languageId);
        this.onDidRequestLanguageFeaturesEmitter.fire(languageId);
    }

    public readonly onDidRequestLanguageFeatures = this.onDidRequestLanguageFeaturesEmitter.event;

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
     * The first declared one, as with aliases. For dotfile languages the "extension" is the whole name (`.editorconfig`),
     * so joining it with the buffer name does not make sense for every language; an untitled buffer is `plaintext`.
     */
    public getExtensionForLanguage(languageId: string): string | undefined {
        return this.languages.get(languageId)?.extensions[0];
    }

    /** Order as in VS Code: `filenames`, then `filenamePatterns`, then `extensions` (case-insensitive). */
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

        // Several languages claim the same `.ext`: the one registered later wins, as in VS Code
        // (a user extension after builtin: `editorconfig` beats `properties`). Hence the last one is taken.
        const ext = path.extname(baseName).toLowerCase();
        let match: string | undefined;
        for (const entry of this.languages.values()) {
            for (const candidate of entry.extensions) {
                const cand = candidate.toLowerCase();
                // A regular extension (foo.ts -> ".ts") or a dotfile whose whole name
                // matches the "extension" (.editorconfig): their `path.extname`
                // is empty, but VS Code matches them by name suffix.
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
        // firstLine/configurationPath are not rolled back on unregister; they go away with the empty entry.

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

/** Only `*` and `?`: enough for real extensions' `filenamePatterns`. */
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
