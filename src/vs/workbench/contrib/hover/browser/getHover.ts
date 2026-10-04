import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ILanguageFeatureTarget,
    LanguageFeatureRegistry,
} from "../../../../editor/common/languageFeatureRegistry.ts";
import type { HoverProvider, ICoreHover, IHoverRequest } from "../../../../editor/common/languages/iHoverSource.ts";

/**
 * Hover'ы всех подошедших документу провайдеров (upstream
 * `editor/contrib/hover/browser/getHover.ts`): спрашиваем параллельно, ответы
 * склеиваем в порядке `ordered` — выше score первым, при равном — более поздняя
 * регистрация. Сбойный провайдер не роняет остальных: его ответ — «hover'а нет».
 */
export async function getHovers(
    registry: LanguageFeatureRegistry<HoverProvider>,
    target: ILanguageFeatureTarget,
    request: IHoverRequest,
    token: ICancellationToken,
): Promise<ICoreHover[]> {
    const results = await Promise.all(
        registry.ordered(target).map((provider) => provider.provideHover(request, token).catch(() => undefined)),
    );
    return results.filter((hover) => hover !== undefined);
}
