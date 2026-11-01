import { Uri } from "../../../../base/common/uri.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";

export interface IRevealLocationEditor {
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

export interface IRevealLocationTarget {
    openUri(uri: Uri): Promise<void> | void;
    getActiveEditor(): IRevealLocationEditor | null;
}

/**
 * The whole navigation is one history entry (see IJumpRecorder). A non-disk target opens via the scheme provider,
 * so the position can be set only after that.
 */
export function revealLocation(
    target: IRevealLocationTarget,
    jumps: IJumpRecorder,
    resource: string,
    range: IRange,
): void {
    const uri = Uri.parse(resource);
    const reveal = (): void => {
        const editor = target.getActiveEditor();
        if (editor === null) return;
        editor.goToPosition(range.start.line, range.start.character);
        editor.revealRange(range);
    };
    if (uri.scheme !== "file") {
        void jumps.jumpAsync(async () => {
            await target.openUri(uri);
            reveal();
        });
        return;
    }
    jumps.jump(() => {
        void target.openUri(uri);
        reveal();
    });
}
