import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { getLinks, resolveLinkTarget } from "../../../../editor/contrib/links/browser/getLinks.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { openDocumentModels } from "../../../api/browser/documentSyncAdapter.ts";
import { type IWireExecutedDocumentLink, reviveWireUri } from "../../../api/common/wireTypes.ts";
import type { IWorkbenchContribution } from "../../../common/iWorkbenchContribution.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";

export const EXECUTE_LINK_PROVIDER_COMMAND_ID = "_executeLinkProvider";

export const ExecuteLinkProviderCommandContributionDIToken = token<ExecuteLinkProviderCommandContribution>(
    "ExecuteLinkProviderCommandContribution",
);

/**
 * Upstream `_executeLinkProvider` (`getLinks.ts`), behind the API command `vscode.executeLinkProvider`: the extension
 * host calls it by id, so it exists before extensions start. Here, not in the extension host, so the built-in URL
 * detector answers too.
 */
export class ExecuteLinkProviderCommandContribution extends Disposable implements IWorkbenchContribution {
    public static dependencies = [
        CommandRegistryDIToken,
        EditorServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    public constructor(commands: CommandRegistry, editors: IEditorService, languageFeatures: ILanguageFeaturesService) {
        super();
        this.register(
            commands.register(EXECUTE_LINK_PROVIDER_COMMAND_ID, (uri, resolveCount) =>
                executeLinkProvider(editors, languageFeatures, uri, resolveCount),
            ),
        );
    }
}

/**
 * From the extension host the uri comes as `Uri.toJSON()` components, an absent `linkResolveCount` as `null`.
 * No loaded model — `[]`, as upstream (the command does not open the document).
 */
async function executeLinkProvider(
    editors: IEditorService,
    languageFeatures: ILanguageFeaturesService,
    rawUri: unknown,
    resolveCount: unknown,
): Promise<IWireExecutedDocumentLink[]> {
    const uri = reviveWireUri(rawUri)?.toString();
    const model = [...openDocumentModels(editors)].find((candidate) => candidate.uri.toString() === uri);
    if (model === undefined) return [];
    const document = model.document;
    const links = await getLinks(
        languageFeatures.documentLinkProvider,
        model,
        { uri: model.uri.toString(), languageId: model.languageId, versionId: document.versionId, document },
        CancellationTokenNone,
    );
    // The extension host has checked it is a number; absent (`null`, `undefined`) resolves nothing.
    const count = Number(resolveCount);
    // Upstream `Link.resolve`. Deviation: a link nobody can resolve, or whose resolve gave no target, stays without
    // one; upstream rejects the whole command.
    return Promise.all(
        links.map(async (link, index) => ({
            range: link.range,
            target: index < count ? ((await resolveLinkTarget(link, CancellationTokenNone)) ?? undefined) : link.url,
            tooltip: link.tooltip,
        })),
    );
}
