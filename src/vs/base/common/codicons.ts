import { CODICON_GLYPHS } from "./codicons.generated.ts";

/**
 * Разметка значка в тексте метки VS Code: `$(имя)` либо `$(имя~модификатор)`
 * (`$(sync~spin)`). Экранированный `\$(имя)` значком не считается — это
 * литерал. Регулярка — калька с `renderLabelWithIcons` upstream (имена
 * codicon'ов состоят из строчных букв, цифр и дефисов).
 */
const ICON_MARKUP = /(\\)?\$\(([a-z0-9-]+?)(?:~[a-z0-9-]*?)?\)/giu;

/**
 * Подменяет разметку значков в тексте на символы шрифта: `$(check) Ready` →
 * `✓ Ready`. Так пишут метки почти все расширения, и без подмены в интерфейсе
 * висел бы литерал `$(check)`.
 *
 * Правила (осознанные отклонения от upstream, где значок — отдельный span):
 * - известное имя → символ codicon-шрифта (таблица `codicons.generated.ts`);
 * - **неизвестное имя выбрасывается**: показать литерал `$(foo)` хуже, чем
 *   ничего, а нарисовать нечем;
 * - **модификатор игнорируется** (`~spin` — анимация вращения, которой у нас
 *   нет): рисуем статичный значок;
 * - `\$(имя)` — экранированный литерал: обратный слэш снимается, скобки
 *   остаются (как в upstream).
 */
export function renderCodicons(text: string): string {
    return text.replace(ICON_MARKUP, (match: string, escape: string | undefined, name: string) => {
        if (escape !== undefined) return match.slice(1);
        return CODICON_GLYPHS[name.toLowerCase()] ?? "";
    });
}
