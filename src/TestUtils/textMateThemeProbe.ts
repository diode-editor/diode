/**
 * Скоупов в токенах нет — тема матчится грамматикой, поэтому проба: грамматика
 * `scopes[0]` из одного правила, чьё `name` — остальные скоупы через пробел (стопкой).
 */
import { createDevAssetAccess } from "../vs/base/node/assets/createDefaultAssetAccess.ts";
import { ColorMapTokenStyleResolver } from "../vs/editor/common/languages/colorMapTokenStyleResolver.ts";
import type { ResolvedTokenStyle } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import type { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { TextMateGrammarLoader } from "../vs/workbench/services/textMate/common/textMateGrammarLoader.ts";
import { createTextMateTheme } from "../vs/workbench/services/themes/common/textMateTheme.ts";

export async function resolveScopesStyle(
    theme: WorkbenchTheme,
    scopes: readonly string[],
): Promise<ResolvedTokenStyle> {
    const [root, ...rest] = scopes;
    const grammar = JSON.stringify({ scopeName: root, patterns: [{ match: "x", name: rest.join(" ") }] });
    // Свой экземпляр доступа к ассетам: onig.wasm — настоящий, текст грамматики — проба.
    const assets = Object.assign(createDevAssetAccess(), { readText: () => Promise.resolve(grammar) });
    const loader = new TextMateGrammarLoader(assets, [{ scopeName: root, path: "probe.json" }]);
    try {
        const textMateTheme = createTextMateTheme(theme);
        loader.setTheme(textMateTheme);
        const support = await loader.loadSupport(root);
        if (support === null) throw new Error(`probe grammar ${root} not loaded`);
        const { tokens } = support.tokenizeEncoded("x", true, support.getInitialState());
        return new ColorMapTokenStyleResolver({ getColorMap: () => textMateTheme.colorMap }).resolve(tokens[1]);
    } finally {
        loader.dispose();
    }
}
