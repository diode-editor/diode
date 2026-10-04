import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
    SignatureHelpProvider,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";

/**
 * Подсказка от первого ответившего провайдера (upstream
 * `editor/contrib/parameterHints/browser/provideSignatureHelp.ts`): спрашиваем
 * по очереди в порядке `ordered` до первого непустого ответа — склеивать
 * подсказки нечего, активный параметр у неё один. Сбойный провайдер = «подсказки
 * нет», очередь идёт дальше.
 */
export async function provideSignatureHelp(
    providers: readonly SignatureHelpProvider[],
    request: ISignatureHelpRequest,
    token: ICancellationToken,
): Promise<ICoreSignatureHelp | null> {
    for (const provider of providers) {
        const help = await provider.provideSignatureHelp(request, token).catch(() => null);
        if (help !== null) return help;
    }
    return null;
}
