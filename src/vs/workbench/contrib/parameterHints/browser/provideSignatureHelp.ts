import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ICoreSignatureHelp,
    ISignatureHelpRequest,
    SignatureHelpProvider,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";

/**
 * upstream `provideSignatureHelp`: one by one until the first non-empty answer — a hint has a single
 * active parameter. A failing provider means "no hint" and the queue moves on.
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
