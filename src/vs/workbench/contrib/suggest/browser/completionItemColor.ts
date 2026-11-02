import { computeDefaultDocumentColors } from "../../../../editor/common/languages/defaultDocumentColorsComputer.ts";
import type { ICoreCompletionItem } from "../../../../editor/common/languages/iCompletionSource.ts";
import { packColor } from "../../../../editor/contrib/colorPicker/browser/colorDetector.ts";

/** `CompletionItemKind.Color` of the extension API. */
const COLOR_KIND = 15;

// Stryker disable Regex: upstream's verbatim expressions; the value they let through is parsed again below
const REGEX_RELAXED =
    /(#([\da-fA-F]{3}){1,2}|(rgb|hsl)a\(\s*(\d{1,3}%?\s*,\s*){3}(1|0?\.\d+)\)|(rgb|hsl)\(\s*\d{1,3}%?(\s*,\s*\d{1,3}%?){2}\s*\))/;
const REGEX_STRICT = new RegExp(`^${REGEX_RELAXED.source}$`, "i");
// Stryker restore Regex

/** Upstream `ColorExtractor.extract` of `suggestWidgetRenderer.ts`: the whole label or detail, or a color at an edge of the documentation. */
function colorText(item: ICoreCompletionItem): string | undefined {
    if (REGEX_STRICT.test(item.label)) return item.label;
    // `undefined` turns into the text "undefined", which holds no color.
    if (REGEX_STRICT.test(String(item.detail))) return item.detail;
    const documentation = String(item.documentation);
    const match = REGEX_RELAXED.exec(documentation);
    if (match !== null && (match.index === 0 || match.index + match[0].length === documentation.length)) {
        return match[0];
    }
    return undefined;
}

/**
 * The packed color of a color item, drawn as a square in place of its kind icon (upstream's `colorspan`).
 * A text the browser could paint but the default color computer cannot parse keeps the icon.
 */
export function completionItemColor(item: ICoreCompletionItem): number | undefined {
    if (item.kind !== COLOR_KIND) return undefined;
    const text = colorText(item);
    if (text === undefined) return undefined;
    const parsed = computeDefaultDocumentColors({
        // Stryker disable next-line ObjectLiteral: the range of the parsed color is never read, only its color
        positionAt: (offset) => ({ line: 0, character: offset }),
        findMatches: (regex) => [...text.matchAll(regex)],
    }).at(0);
    return parsed === undefined ? undefined : packColor(parsed.color);
}
