/** Paths (`configuration`, `icon.*`) are relative to the extension directory. */
export interface ILanguageContribution {
    readonly id: string;

    /** The first one is the display name; an empty array hides the language from the picker. */
    readonly aliases?: readonly string[];

    /** With the dot: `".ts"`. */
    readonly extensions?: readonly string[];

    readonly filenames?: readonly string[];

    readonly filenamePatterns?: readonly string[];

    /** Regexp matched against the first line. */
    readonly firstLine?: string;

    readonly mimetypes?: readonly string[];

    readonly configuration?: string;

    /** Unused. */
    readonly icon?: {
        readonly light: string;
        readonly dark: string;
    };
}
