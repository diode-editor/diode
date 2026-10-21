import { CODICON_GLYPHS } from "./codicons.generated.ts";

/** `$(имя)`, `$(имя~модификатор)` или экранированный `\$(имя)`; калька с `renderLabelWithIcons` upstream. */
const ICON_MARKUP = /(\\)?\$\(([a-z0-9-]+?)(?:~[a-z0-9-]*?)?\)/giu;

/**
 * Неизвестное имя выбрасывается — литерал `$(foo)` хуже пустоты; модификатор
 * (`~spin`) игнорируется — анимации нет.
 */
export function renderCodicons(text: string): string {
    return text.replace(ICON_MARKUP, (match: string, escape: string | undefined, name: string) => {
        if (escape !== undefined) return match.slice(1);
        return CODICON_GLYPHS[name.toLowerCase()] ?? "";
    });
}
