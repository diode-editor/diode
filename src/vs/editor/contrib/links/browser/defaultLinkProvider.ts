import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { MODEL_SYNC_LIMIT, scanDocumentInIdleSlices } from "../../../common/languages/idleDocumentScan.ts";
import type { ILink, ILinkRequest, LinkProvider } from "../../../common/languages/iLinkSource.ts";
import { computeLinks } from "../../../common/languages/linkComputer.ts";
import type { ILanguageFeaturesService } from "../../../common/services/languageFeatures.ts";

/** Upstream's provider on `*` (`editorWorkerService.ts`, `computeLinks` in the worker). */
export class DefaultLinkProvider implements LinkProvider {
    public constructor(private readonly syncLimit = MODEL_SYNC_LIMIT) {}

    public provideLinks(request: ILinkRequest, token: ICancellationToken): Promise<ILink[] | null> {
        const { document, versionId } = request;
        return scanDocumentInIdleSlices(document, versionId, token, this.syncLimit, (from, to) =>
            computeLinks(document, from, to),
        );
    }
}

export function registerDefaultLinkProvider(languageFeatures: ILanguageFeaturesService): IDisposable {
    return languageFeatures.documentLinkProvider.register("*", new DefaultLinkProvider());
}
