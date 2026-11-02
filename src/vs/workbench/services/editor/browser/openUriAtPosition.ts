import type { Uri } from "../../../../base/common/uri.ts";
import type { IJumpRecorder } from "../../history/browser/historyService.ts";
import type { IEditorService } from "../common/editorService.ts";

/**
 * A file opens pinned (`openUri` never previews unless asked), an already open one is activated; a 0-based position
 * sets the cursor. A jump for Go Back, like every navigation by a link.
 */
export async function openUriAtPosition(
    editors: IEditorService,
    jumps: IJumpRecorder,
    uri: Uri,
    position: { readonly line: number; readonly column: number } | undefined,
): Promise<void> {
    const key = uri.toString();
    await jumps.jumpAsync(async () => {
        // Upstream `revealIfOpened: true`: a tab in another group is activated there, not duplicated here.
        const groups = editors.editorGroups;
        const owner = [groups.activeGroup, ...groups.groups].find((group) => group.findPaneIndex(uri) >= 0);
        // Stryker disable next-line ConditionalExpression: `{ group: undefined }` picks the group like no option at all.
        await editors.openUri(uri, owner === undefined ? {} : { group: owner });
        if (position === undefined) return;
        const editor = editors.getActiveEditor();
        // Stryker disable next-line ConditionalExpression,OptionalChaining: the file failed to open; whatever editor stays active keeps its cursor.
        if (editor?.uri.toString() !== key) return;
        editor.goToPosition(position.line, position.column);
    });
}
