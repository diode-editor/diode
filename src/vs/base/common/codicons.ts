import { CODICON_GLYPHS } from "./codicons.generated.ts";
import { CODICON_UNICODE } from "./codiconsUnicode.ts";

/**
 * A product icon in both glyph sets (`diode.icons.nerdFont`). Upstream an icon is a `ThemeIcon` id
 * resolved through the product icon theme; ours resolves through `ProductIconService`.
 */
export interface IProductIcon {
    /** A Nerd Font glyph from the Private Use Area. */
    readonly nerdFont: string;
    /** A one-cell BMP character outside the Private Use Area. */
    readonly unicode: string;
}

/** Both forms of a codicon by name; a name missing from a table gives `""` in that set. */
export function codicon(name: string): IProductIcon {
    return { nerdFont: CODICON_GLYPHS[name] ?? "", unicode: CODICON_UNICODE[name] ?? "" };
}

export function iconGlyph(icon: IProductIcon, nerdFont: boolean): string {
    return nerdFont ? icon.nerdFont : icon.unicode;
}

/** `$(name)`, `$(name~modifier)` or escaped `\$(name)`; mirrors upstream's `renderLabelWithIcons`. */
const ICON_MARKUP = /(\\)?\$\(([a-z0-9-]+?)(?:~[a-z0-9-]*?)?\)/giu;

/**
 * An unknown name is dropped: a literal `$(foo)` is worse than nothing. The modifier
 * (`~spin`) is ignored: there is no animation.
 */
export function renderCodicons(text: string, nerdFont: boolean): string {
    const table = nerdFont ? CODICON_GLYPHS : CODICON_UNICODE;
    return text.replace(ICON_MARKUP, (match: string, escape: string | undefined, name: string) => {
        if (escape !== undefined) return match.slice(1);
        return table[name.toLowerCase()] ?? "";
    });
}
