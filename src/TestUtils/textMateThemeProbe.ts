/**
 * Стиль, который тема даст токену со стеком скоупов `scopes`, — как его
 * посчитает настоящий vscode-textmate (`Registry.setTheme` + `tokenizeLine2`) и
 * рендер (`ColorMapTokenStyleResolver`). Для тестов тем: скоупов в токенах больше
 * нет, тема матчится грамматикой. Проба — грамматика `scopes[0]` из одного
 * правила, чьё `name` — остальные скоупы через пробел (TextMate кладёт их
 * стопкой).
 */
import type { IAssetAccess, IAssetEntry } from "../vs/base/common/assets/iAssetAccess.ts";
import { createDevAssetAccess } from "../vs/base/node/assets/createDefaultAssetAccess.ts";
import { ColorMapTokenStyleResolver } from "../vs/editor/common/languages/colorMapTokenStyleResolver.ts";
import type { ResolvedTokenStyle } from "../vs/editor/common/languages/iTokenStyleResolver.ts";
import type { WorkbenchTheme } from "../vs/platform/theme/common/workbenchTheme.ts";
import { TextMateGrammarLoader } from "../vs/workbench/services/textMate/common/textMateGrammarLoader.ts";
import { createTextMateTheme } from "../vs/workbench/services/themes/common/textMateTheme.ts";

const devAssets = createDevAssetAccess();

class ProbeAssets implements IAssetAccess {
    private readonly grammar: string;

    public constructor(grammar: string) {
        this.grammar = grammar;
    }

    public read(virtualPath: string): Promise<Uint8Array> {
        return devAssets.read(virtualPath);
    }

    public readText(): Promise<string> {
        return Promise.resolve(this.grammar);
    }

    public exists(): Promise<boolean> {
        return Promise.resolve(true);
    }

    public listEntries(): Promise<IAssetEntry[]> {
        return Promise.resolve([]);
    }
}

export async function resolveScopesStyle(
    theme: WorkbenchTheme,
    scopes: readonly string[],
): Promise<ResolvedTokenStyle> {
    const [root, ...rest] = scopes;
    const grammar = JSON.stringify({ scopeName: root, patterns: [{ match: "x", name: rest.join(" ") }] });
    const loader = new TextMateGrammarLoader(new ProbeAssets(grammar), [{ scopeName: root, path: "probe.json" }]);
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
