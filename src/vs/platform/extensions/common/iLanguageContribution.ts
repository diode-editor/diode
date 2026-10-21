/** Пути (`configuration`, `icon.*`) — относительно каталога расширения. */
export interface ILanguageContribution {
    readonly id: string;

    /** Первый — display name; пустой массив — язык не показывается в picker. */
    readonly aliases?: readonly string[];

    /** С точкой: `".ts"`. */
    readonly extensions?: readonly string[];

    readonly filenames?: readonly string[];

    readonly filenamePatterns?: readonly string[];

    /** Регэксп по первой строке. */
    readonly firstLine?: string;

    readonly mimetypes?: readonly string[];

    readonly configuration?: string;

    /** Не используется. */
    readonly icon?: {
        readonly light: string;
        readonly dark: string;
    };
}
