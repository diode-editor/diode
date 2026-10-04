import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { ILanguageFeatureTarget, LanguageFeatureRegistry } from "../../common/languageFeatureRegistry.ts";
import type {
    CodeActionProvider,
    ICodeActionRequest,
    ICoreCodeAction,
} from "../../common/languages/iCodeActionSource.ts";

/**
 * Действие вместе с провайдером, который его отдал (upstream `CodeActionItem`):
 * применяет его `applyCodeAction` того же провайдера.
 */
export interface ICodeActionItem {
    readonly action: ICoreCodeAction;
    readonly provider: CodeActionProvider;
}

/**
 * Пересекаются ли иерархические виды (`CodeActionKind.intersects`): один
 * содержит другой — равен ему или его префикс по точке (`source` ⊃
 * `source.fixAll.ruff`).
 */
export function codeActionKindsIntersect(a: string, b: string): boolean {
    return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}

/**
 * Code actions от всех подошедших документу провайдеров (upstream
 * `editor/contrib/codeAction/browser/codeAction.ts:getCodeActions`): провайдер,
 * чьи `providedCodeActionKinds` не пересекаются с запрошенным `only`, не
 * спрашивается вовсе; остальные — параллельно, ответы склеиваются в порядке
 * `ordered`. Сбойный провайдер = «действий нет».
 */
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
