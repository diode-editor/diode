import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
    SignatureHelpProvider,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";

/**
 * upstream `provideSignatureHelp`: по очереди до первого непустого ответа — активный параметр у
 * подсказки один. Сбойный провайдер = «подсказки нет», очередь идёт дальше.
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
