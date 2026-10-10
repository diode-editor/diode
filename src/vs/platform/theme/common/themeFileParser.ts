import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import { isHexColor } from "./colorUtils.ts";
import type {
    ISemanticTokenColorRule,
    ISemanticTokenColorSettings,
    IThemeFile,
    ITokenColorRule,
    ITokenColorSettings,
} from "./iThemeFile.ts";

/**
 * Разбор файла цветовой темы VS Code (JSON/JSONC: комментарии и висячие
 * запятые — так публикуют многие темы) в {@link IThemeFile}, пригодный для
 * `WorkbenchTheme.fromThemeFile` без исключений в рантайме.
 *
 * Битый JSON и не-объект — ошибка (тему пропускает вызывающий). Всё, что
 * можно спасти, спасается с предупреждением через `warn`: невалидные цвета
 * (`WorkbenchTheme` бросил бы на них при `resolve`), правила `tokenColors` без
 * `settings`, `tokenColors` строкой (путь к `.tmTheme`, plist XML — не
 * поддержан: подсветка остаётся дефолтной, решение 8 в Theming.md).
 * `name` из файла не читается — ключ темы задаёт манифест (`label`).
 * `semanticHighlighting` берётся, только если это `true`/`false`;
 * `semanticTokenColors` разбирается в {@link IThemeFile.semanticTokenRules}
 * (стиль без единого валидного атрибута — пропуск с предупреждением; селектор
 * не проверяется — кривой просто ни с чем не совпадёт, как в эталоне).
 */
export function parseThemeFile(text: string, warn: (message: string) => void = () => undefined): IThemeFile {
    const errors: ParseError[] = [];
    const raw: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length > 0) {
        const first = errors[0];
        throw new Error(`invalid JSON: ${printParseErrorCode(first.error)} at offset ${String(first.offset)}`);
    }
    if (!isRecord(raw)) throw new Error("theme file is not a JSON object");

    const theme: IThemeFile = {
        colors: parseColors(raw.colors, warn),
        tokenColors: parseTokenColors(raw.tokenColors, warn),
    };
    if (typeof raw.include === "string") theme.include = raw.include;
    if (typeof raw.semanticHighlighting === "boolean") theme.semanticHighlighting = raw.semanticHighlighting;
    if (raw.semanticTokenColors !== undefined) {
        theme.semanticTokenRules = parseSemanticTokenColors(raw.semanticTokenColors, warn);
    }
    return theme;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseColors(value: unknown, warn: (message: string) => void): Record<string, string> {
    const colors: Record<string, string> = {};
    if (value === undefined) return colors;
    if (!isRecord(value)) {
        warn("colors is not an object — ignored");
        return colors;
    }
    for (const [key, color] of Object.entries(value)) {
        if (isHexColor(color)) {
            colors[key] = color;
        } else {
            warn(`colors["${key}"]: invalid color ${JSON.stringify(color)} — ignored`);
        }
    }
    return colors;
}

function parseTokenColors(value: unknown, warn: (message: string) => void): ITokenColorRule[] {
    if (value === undefined) return [];
    if (typeof value === "string") {
        warn(`tokenColors "${value}": tmTheme tokenColors are not supported — syntax colors fall back to defaults`);
        return [];
    }
    if (!Array.isArray(value)) {
        warn("tokenColors is neither an array nor a path — ignored");
        return [];
    }
    const rules: ITokenColorRule[] = [];
    (value as unknown[]).forEach((entry, index) => {
        const rule = parseTokenColorRule(entry, (reason) => {
            warn(`tokenColors[${String(index)}]: ${reason}`);
        });
        if (rule !== null) rules.push(rule);
    });
    return rules;
}

function parseTokenColorRule(entry: unknown, warn: (reason: string) => void): ITokenColorRule | null {
    if (!isRecord(entry) || !isRecord(entry.settings)) {
        warn("rule without settings — ignored");
        return null;
    }
    const scope = entry.scope;
    const rule: ITokenColorRule = { settings: parseTokenSettings(entry.settings, warn) };
    if (typeof entry.name === "string") rule.name = entry.name;
    if (typeof scope === "string") {
        rule.scope = scope;
    } else if (Array.isArray(scope)) {
        rule.scope = (scope as unknown[]).filter((s): s is string => typeof s === "string");
    } else if (scope !== undefined) {
        warn("scope is neither a string nor an array — ignored");
        return null;
    }
    return rule;
}

function parseTokenSettings(raw: Record<string, unknown>, warn: (reason: string) => void): ITokenColorSettings {
    const settings: ITokenColorSettings = {};
    for (const key of ["foreground", "background"] as const) {
        const color = raw[key];
        if (color === undefined) continue;
        if (isHexColor(color)) {
            settings[key] = color;
        } else {
            warn(`invalid ${key} ${JSON.stringify(color)} — ignored`);
        }
    }
    if (typeof raw.fontStyle === "string") settings.fontStyle = raw.fontStyle;
    return settings;
}

function parseSemanticTokenColors(value: unknown, warn: (message: string) => void): ISemanticTokenColorRule[] {
    if (!isRecord(value)) {
        warn("semanticTokenColors is not an object — ignored");
        return [];
    }
    const rules: ISemanticTokenColorRule[] = [];
    for (const [selector, raw] of Object.entries(value)) {
        const settings = parseSemanticTokenSettings(raw, (reason) => {
            warn(`semanticTokenColors["${selector}"]: ${reason}`);
        });
        if (settings !== null) rules.push({ selector, settings });
    }
    return rules;
}

/**
 * Значение правила `semanticTokenColors`: строка — цвет, объект — стиль
 * (`readSemanticTokenRule` эталона). Ни одного атрибута — правило пропускается.
 */
function parseSemanticTokenSettings(raw: unknown, warn: (reason: string) => void): ISemanticTokenColorSettings | null {
    const settings: ISemanticTokenColorSettings = {};
    const record: Record<string, unknown> = typeof raw === "string" ? { foreground: raw } : isRecord(raw) ? raw : {};
    const foreground = record.foreground;
    if (foreground !== undefined) {
        if (isHexColor(foreground)) {
            settings.foreground = foreground;
        } else {
            warn(`invalid foreground ${JSON.stringify(foreground)} — ignored`);
        }
    }
    if (typeof record.fontStyle === "string") settings.fontStyle = record.fontStyle;
    for (const key of ["bold", "italic", "underline", "strikethrough"] as const) {
        const flag = record[key];
        if (typeof flag === "boolean") settings[key] = flag;
    }
    if (Object.keys(settings).length === 0) {
        warn("no style — ignored");
        return null;
    }
    return settings;
}
