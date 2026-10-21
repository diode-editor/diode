import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../common/languageFeatureRegistry.ts";
import type {
    CodeActionProvider,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../common/languages/iCodeActionSource.ts";

/** Upstream `CodeActionItem`: применяет `applyCodeAction` того же провайдера. */
export interface ICodeActionItem {
    readonly action: ICoreCodeAction;
    readonly provider: CodeActionProvider;
}

/** `CodeActionKind.intersects`: `source` ⊃ `source.fixAll.ruff`. */
export function codeActionKindsIntersect(a: string, b: string): boolean {
    return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/** Upstream `editor/contrib/codeAction/browser/codeAction.ts:getCodeActions`. */
export async function getCodeActions(
    registry: LanguageFeatureRegistry<CodeActionProvider>,
    target: ILanguageFeatureTarget,
    request: ICodeActionRequest,
    token: ICancellationToken,
): Promise<ICodeActionItem[]> {
    const { only } = request;
    const providers = registry
        .ordered(target)
        .filter(
            (provider) =>
                only === undefined ||
                provider.providedCodeActionKinds.length === 0 ||
                provider.providedCodeActionKinds.some((kind) => codeActionKindsIntersect(kind, only)),
        );
    const results = await Promise.all(
        providers.map((provider) => provider.provideCodeActions(request, token).catch(() => [])),
    );
    return results.flatMap((result, index) => result.map((action) => ({ action, provider: providers[index] })));
}
