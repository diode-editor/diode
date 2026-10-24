import { createRange } from "../../../../../editor/common/core/iRange.ts";
import type { SidebarService } from "../../../../browser/parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../../../../browser/parts/sidebar/sidebarService.ts";
import type { IEditorService } from "../../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../../services/editor/common/editorService.ts";
import type { IJumpRecorder } from "../../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../../services/history/browser/historyService.ts";
import { EXPLORER_VIEWLET_ID } from "../../../files/browser/explorerComponent.ts";
import type { ExplorerService } from "../../../files/browser/explorerService.ts";
import { ExplorerServiceDIToken } from "../../../files/browser/explorerService.ts";
import { getLinkSuffix } from "../common/terminalLinkParsing.ts";
import type { ITerminalLink } from "../common/terminalLinkProvider.ts";

/**
 * Upstream `TerminalLocalFileLinkOpener` and `TerminalLocalFolderInWorkspaceLinkOpener`. A file opens pinned
 * (`openUri` never previews unless asked), an already open one is activated; the suffix sets the cursor.
 * A folder is revealed in the Explorer, like upstream's `revealInExplorer` command.
 */
export class TerminalLinkOpener {
    public static dependencies = [
        EditorServiceDIToken,
        JumpRecorderDIToken,
        SidebarServiceDIToken,
        ExplorerServiceDIToken,
    ] as const;

    public constructor(
        private readonly editors: IEditorService,
        private readonly jumps: IJumpRecorder,
        private readonly sidebar: SidebarService,
        private readonly explorer: ExplorerService,
    ) {}

    public async open(link: ITerminalLink): Promise<void> {
        if (link.type === "LocalFolderInWorkspace") {
            this.sidebar.showViewlet(EXPLORER_VIEWLET_ID);
            await this.explorer.revealPath(link.uri.fsPath);
            return;
        }
        // The suffix is 1-based as printed; the editor is 0-based.
        const suffix = link.parsedLink ? link.parsedLink.suffix : getLinkSuffix(link.text);
        const key = link.uri.toString();
        await this.jumps.jumpAsync(async () => {
            await this.editors.openUri(link.uri);
            const row = suffix?.row;
            if (row === undefined) return;
            const editor = this.editors.getActiveEditor();
            if (editor?.uri.toString() !== key) return;
            const line = row - 1;
            const column = (suffix?.col ?? 1) - 1;
            editor.goToPosition(line, column);
            editor.revealRange(createRange(line, column, line, column));
        });
    }
}
