/**
 * The encodings the editor offers: pure data, no imports, so configuration nodes (`files.encoding`) can
 * take it into the settings schema generator's bundle.
 */

export interface IEncodingInfo {
    /** Canonical VS Code id, exactly the API's `TextDocument.encoding`; the extension bridge does not map it. */
    readonly id: string;
    readonly label: string;
    readonly statusLabel: string;
    /** Differs from id only for "utf8bom". */
    readonly iconvName: string;
    readonly bom?: readonly number[];
    /** jschardet's name: only these encodings can be candidates for guessing (upstream `GUESSABLE_ENCODINGS`). */
    readonly guessableName?: string;
}

export const BOM_UTF8 = [0xef, 0xbb, 0xbf] as const;
export const BOM_UTF16LE = [0xff, 0xfe] as const;
export const BOM_UTF16BE = [0xfe, 0xff] as const;

/** Same order as VS Code's SUPPORTED_ENCODINGS. */
export const SUPPORTED_ENCODINGS: readonly IEncodingInfo[] = [
    { id: "utf8", label: "UTF-8", statusLabel: "UTF-8", iconvName: "utf8", guessableName: "UTF-8" },
    { id: "utf8bom", label: "UTF-8 with BOM", statusLabel: "UTF-8 with BOM", iconvName: "utf8", bom: BOM_UTF8 },
    {
        id: "utf16le",
        label: "UTF-16 LE",
        statusLabel: "UTF-16 LE",
        iconvName: "utf16le",
        bom: BOM_UTF16LE,
        guessableName: "UTF-16LE",
    },
    {
        id: "utf16be",
        label: "UTF-16 BE",
        statusLabel: "UTF-16 BE",
        iconvName: "utf16be",
        bom: BOM_UTF16BE,
        guessableName: "UTF-16BE",
    },
    {
        id: "windows1252",
        label: "Western (Windows 1252)",
        statusLabel: "Windows 1252",
        iconvName: "windows1252",
        guessableName: "windows-1252",
    },
    { id: "iso88591", label: "Western (ISO 8859-1)", statusLabel: "ISO 8859-1", iconvName: "iso88591" },
    { id: "iso88593", label: "Western (ISO 8859-3)", statusLabel: "ISO 8859-3", iconvName: "iso88593" },
    { id: "iso885915", label: "Western (ISO 8859-15)", statusLabel: "ISO 8859-15", iconvName: "iso885915" },
    { id: "macroman", label: "Western (Mac Roman)", statusLabel: "Mac Roman", iconvName: "macroman" },
    { id: "cp437", label: "DOS (CP 437)", statusLabel: "CP437", iconvName: "cp437" },
    { id: "windows1256", label: "Arabic (Windows 1256)", statusLabel: "Windows 1256", iconvName: "windows1256" },
    { id: "iso88596", label: "Arabic (ISO 8859-6)", statusLabel: "ISO 8859-6", iconvName: "iso88596" },
    { id: "windows1257", label: "Baltic (Windows 1257)", statusLabel: "Windows 1257", iconvName: "windows1257" },
    { id: "iso88594", label: "Baltic (ISO 8859-4)", statusLabel: "ISO 8859-4", iconvName: "iso88594" },
    { id: "iso885914", label: "Celtic (ISO 8859-14)", statusLabel: "ISO 8859-14", iconvName: "iso885914" },
    {
        id: "windows1250",
        label: "Central European (Windows 1250)",
        statusLabel: "Windows 1250",
        iconvName: "windows1250",
        guessableName: "windows-1250",
    },
    {
        id: "iso88592",
        label: "Central European (ISO 8859-2)",
        statusLabel: "ISO 8859-2",
        iconvName: "iso88592",
        guessableName: "ISO-8859-2",
    },
    { id: "cp852", label: "Central European (CP 852)", statusLabel: "CP 852", iconvName: "cp852" },
    {
        id: "windows1251",
        label: "Cyrillic (Windows 1251)",
        statusLabel: "Windows 1251",
        iconvName: "windows1251",
        guessableName: "windows-1251",
    },
    { id: "cp866", label: "Cyrillic (CP 866)", statusLabel: "CP 866", iconvName: "cp866", guessableName: "IBM866" },
    {
        id: "cp1125",
        label: "Cyrillic (CP 1125)",
        statusLabel: "CP 1125",
        iconvName: "cp1125",
        guessableName: "IBM1125",
    },
    {
        id: "iso88595",
        label: "Cyrillic (ISO 8859-5)",
        statusLabel: "ISO 8859-5",
        iconvName: "iso88595",
        guessableName: "ISO-8859-5",
    },
    { id: "koi8r", label: "Cyrillic (KOI8-R)", statusLabel: "KOI8-R", iconvName: "koi8r", guessableName: "KOI8-R" },
    { id: "koi8u", label: "Cyrillic (KOI8-U)", statusLabel: "KOI8-U", iconvName: "koi8u" },
    { id: "koi8ru", label: "Cyrillic (KOI8-RU)", statusLabel: "KOI8-RU", iconvName: "koi8ru" },
    { id: "koi8t", label: "Tajik (KOI8-T)", statusLabel: "KOI8-T", iconvName: "koi8t" },
    { id: "iso885913", label: "Estonian (ISO 8859-13)", statusLabel: "ISO 8859-13", iconvName: "iso885913" },
    {
        id: "windows1253",
        label: "Greek (Windows 1253)",
        statusLabel: "Windows 1253",
        iconvName: "windows1253",
        guessableName: "windows-1253",
    },
    {
        id: "iso88597",
        label: "Greek (ISO 8859-7)",
        statusLabel: "ISO 8859-7",
        iconvName: "iso88597",
        guessableName: "ISO-8859-7",
    },
    {
        id: "windows1255",
        label: "Hebrew (Windows 1255)",
        statusLabel: "Windows 1255",
        iconvName: "windows1255",
        guessableName: "windows-1255",
    },
    {
        id: "iso88598",
        label: "Hebrew (ISO 8859-8)",
        statusLabel: "ISO 8859-8",
        iconvName: "iso88598",
        guessableName: "ISO-8859-8",
    },
    { id: "iso885910", label: "Nordic (ISO 8859-10)", statusLabel: "ISO 8859-10", iconvName: "iso885910" },
    { id: "cp865", label: "Nordic DOS (CP 865)", statusLabel: "CP 865", iconvName: "cp865" },
    { id: "iso885916", label: "Romanian (ISO 8859-16)", statusLabel: "ISO 8859-16", iconvName: "iso885916" },
    { id: "windows1254", label: "Turkish (Windows 1254)", statusLabel: "Windows 1254", iconvName: "windows1254" },
    { id: "iso88599", label: "Turkish (ISO 8859-9)", statusLabel: "ISO 8859-9", iconvName: "iso88599" },
    { id: "cp857", label: "Turkish DOS (CP 857)", statusLabel: "CP 857", iconvName: "cp857" },
    { id: "windows1258", label: "Vietnamese (Windows 1258)", statusLabel: "Windows 1258", iconvName: "windows1258" },
    { id: "windows874", label: "Thai (Windows 874)", statusLabel: "Windows 874", iconvName: "windows874" },
    { id: "iso885911", label: "Latin/Thai (ISO 8859-11)", statusLabel: "ISO 8859-11", iconvName: "iso885911" },
    { id: "cp850", label: "Western European DOS (CP 850)", statusLabel: "CP 850", iconvName: "cp850" },
    {
        id: "gb2312",
        label: "Simplified Chinese (GB 2312)",
        statusLabel: "GB 2312",
        iconvName: "gb2312",
        guessableName: "GB2312",
    },
    { id: "gbk", label: "Simplified Chinese (GBK)", statusLabel: "GBK", iconvName: "gbk" },
    { id: "gb18030", label: "Simplified Chinese (GB 18030)", statusLabel: "GB 18030", iconvName: "gb18030" },
    {
        id: "cp950",
        label: "Traditional Chinese (Big5)",
        statusLabel: "Big5",
        iconvName: "cp950",
        guessableName: "Big5",
    },
    {
        id: "big5hkscs",
        label: "Traditional Chinese (Big5-HKSCS)",
        statusLabel: "Big5-HKSCS",
        iconvName: "big5hkscs",
    },
    {
        id: "shiftjis",
        label: "Japanese (Shift JIS)",
        statusLabel: "Shift JIS",
        iconvName: "shiftjis",
        guessableName: "SHIFT_JIS",
    },
    { id: "eucjp", label: "Japanese (EUC-JP)", statusLabel: "EUC-JP", iconvName: "eucjp", guessableName: "EUC-JP" },
    { id: "euckr", label: "Korean (EUC-KR)", statusLabel: "EUC-KR", iconvName: "euckr", guessableName: "EUC-KR" },
];
