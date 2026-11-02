import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILink } from "../../../../editor/common/languages/iLinkSource.ts";
import { resolveLinkTarget } from "../../../../editor/contrib/links/browser/getLinks.ts";
import { type CommandRegistry, CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { targetOf } from "../../../api/browser/viewsWelcomeExtensionPoint.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import { runCodeLensCommand } from "../../../services/editor/browser/codeLensCommand.ts";
import { openUriAtPosition } from "../../../services/editor/browser/openUriAtPosition.ts";
import { EditorServiceDIToken, type IEditorService } from "../../../services/editor/common/editorService.ts";
import {
    ExternalOpenerDIToken,
    type IExternalOpener,
} from "../../../services/externalOpener/common/iExternalOpener.ts";
import { type IJumpRecorder, JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import {
    type NotificationService,
    NotificationServiceDIToken,
} from "../../../services/notification/browser/notificationService.ts";

const EXTERNAL_SCHEMES: readonly string[] = ["http", "https", "mailto"];

/** Upstream `extractSelection`: `#L10`, `#10`, `#L10,5`. Only the start: a pane has no way to select a range from here. */
const POSITION_FRAGMENT = /^L?(\d+)(?:,(\d+))?/;

/**
 * Upstream `file://./relative` and `file:///./relative`. Deviation: upstream joins it to the document's own path,
 * which makes `/dir/file.md/relative`; here it goes next to the document, the only place such a file can be.
 */
function resolveRelativeFile(target: Uri, documentUri: Uri): Uri {
    if (target.scheme !== "file" || documentUri.scheme !== "file") return target;
    const relative =
        target.authority === "." ? target.path : target.path.startsWith("/./") ? target.path.slice(2) : null;
    if (relative === null) return target;
    return Uri.joinPath(documentUri, "..", `.${relative}`).with({ fragment: target.fragment });
}

export const LinksServiceDIToken = token<LinksService>("LinksService");

/** The opening half of upstream `LinkDetector` and its `OpenLinkAction`; `LinkDetector` here only finds links. */
export class LinksService extends Disposable {
    public static dependencies = [
        EditorServiceDIToken,
        JumpRecorderDIToken,
        ExternalOpenerDIToken,
        CommandRegistryDIToken,
        NotificationServiceDIToken,
    ] as const;

    public constructor(
        private readonly editors: IEditorService,
        private readonly jumps: IJumpRecorder,
        private readonly external: IExternalOpener,
        private readonly commands: CommandRegistry,
        private readonly notifications: NotificationService,
    ) {
        super();
        this.register(
            // A press focuses its editor, so the release of a Ctrl+click always lands in the active one.
            bindActiveEditor(editors, (editor, store) => {
                if (editor === null) return;
                store.add(
                    editor.onDidClickLink((link) => {
                        this.openLink(link, editor.uri);
                    }),
                );
            }),
        );
    }

    /** `editor.action.openLink`. */
    public openLinksAtSelections(): void {
        const editor = this.editors.getActiveEditor();
        if (editor === null) return;
        for (const link of editor.getLinksAtSelections()) this.openLink(link, editor.uri);
    }

    private openLink(link: ILink, documentUri: Uri): void {
        void this.open(link, documentUri).catch(onUnexpectedError);
    }

    private async open(link: ILink, documentUri: Uri): Promise<void> {
        const target = await resolveLinkTarget(link, CancellationTokenNone);
        if (target === null) {
            this.warn("Failed to open this link because its target is missing.");
            return;
        }
        let uri: Uri;
        try {
            const parsed = Uri.parse(target, true);
            // The detector takes `HTTP://` and `FILE://` as well.
            uri = parsed.with({ scheme: parsed.scheme.toLowerCase() });
        } catch {
            this.warnNotWellFormed(target);
            return;
        }
        if (uri.scheme === "command") {
            const { command, args } = targetOf(uri.toString()) as { command: string; args: unknown[] };
            await runCodeLensCommand(this.commands, this.notifications, { id: command, title: "", arguments: args });
            return;
        }
        if (EXTERNAL_SCHEMES.includes(uri.scheme)) {
            if (!(await this.external.open(target))) this.warnNotWellFormed(target);
            return;
        }
        await this.openInEditor(resolveRelativeFile(uri, documentUri));
    }

    private async openInEditor(uri: Uri): Promise<void> {
        const match = POSITION_FRAGMENT.exec(uri.fragment);
        if (match === null) {
            await openUriAtPosition(this.editors, this.jumps, uri, undefined);
            return;
        }
        // 1-based as written; the editor is 0-based.
        const [, line, column = "1"] = match;
        await openUriAtPosition(this.editors, this.jumps, uri.with({ fragment: "" }), {
            line: Number(line) - 1,
            column: Number(column) - 1,
        });
    }

    private warnNotWellFormed(target: string): void {
        this.warn(`Failed to open this link because it is not well-formed: ${target}`);
    }

    private warn(message: string): void {
        this.notifications.show({ severity: "warn", message, modal: false, items: [] });
    }
}
