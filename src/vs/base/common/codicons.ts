import { CODICON_GLYPHS } from "./codicons.generated.ts";

/** `$(name)`, `$(name~modifier)` or escaped `\$(name)`; mirrors upstream's `renderLabelWithIcons`. */
const ICON_MARKUP = /(\\)?\$\(([a-z0-9-]+?)(?:~[a-z0-9-]*?)?\)/giu;

/**
 * An unknown name is dropped: a literal `$(foo)` is worse than nothing. The modifier
 * (`~spin`) is ignored: there is no animation.
 */
export function renderCodicons(text: string): string {
    return text.replace(ICON_MARKUP, (match: string, escape: string | undefined, name: string) => {
        if (escape !== undefined) return match.slice(1);
        return CODICON_GLYPHS[name.toLowerCase()] ?? "";
    });
}
