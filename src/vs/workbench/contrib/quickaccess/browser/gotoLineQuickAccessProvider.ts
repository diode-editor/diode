import { parseGotoLineQuery } from "../../../../base/common/lineColumnQuery.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

/** Coordinates are 0-based. */
export interface IGotoLineEditor {
    readonly lineCount: number;
    readonly primaryCursorLine: number;
    readonly primaryCursorColumn: number;
    goToPosition(line: number, column?: number): void;
}

/** Read lazily: a `file:line` accept takes the editor only after the file has opened. */
export interface IGotoLineEditorSource {
    getActiveEditor(): IGotoLineEditor | null;
}

export const GotoLineEditorSourceDIToken = token<IGotoLineEditorSource>("GotoLineEditorSource");

export const GotoLineQuickAccessProviderDIToken = token<GotoLineQuickAccessProvider>("GotoLineQuickAccessProvider");

export class GotoLineQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = ":";

    public static dependencies = [GotoLineEditorSourceDIToken, JumpRecorderDIToken] as const;

    public constructor(
        private readonly editorSource: IGotoLineEditorSource,
        private readonly jumps: IJumpRecorder,
    ) {}

    public getPlaceholder(): string {
        const editor = this.editorSource.getActiveEditor();
        if (editor === null) return "Go to line";
        const line = editor.primaryCursorLine + 1;
        const character = editor.primaryCursorColumn + 1;
        return `Current Line: ${line}, Character: ${character}. Type a line number between 1 and ${editor.lineCount} to navigate to.`;
    }

    public getItems(query: string): QuickAccessItem[] {
        const editor = this.editorSource.getActiveEditor();
        if (editor === null) {
            return [{ label: "No active editor to navigate" }];
        }

        const goto = parseGotoLineQuery(query);
        if (goto === null) {
            return [{ label: `Type a line number between 1 and ${editor.lineCount} to navigate to` }];
        }

        const columnSuffix = goto.column !== undefined ? `:${goto.column}` : "";
        return [
            {
                label: `Go to line ${goto.line}${columnSuffix}`,
                accept: () => {
                    this.jumps.jump(() => {
                        navigateActiveEditor(this.editorSource, goto.line, goto.column);
                    });
                },
            },
        ];
    }
}

/**
 * `line`/`column` are 1-based. The editor is re-read on accept: it may have gone away or just
 * opened (`file:line`). `jumps` also wraps the file open — exactly two history entries.
 */
export function navigateActiveEditor(source: IGotoLineEditorSource, line: number, column: number | undefined): void {
    const editor = source.getActiveEditor();
    if (editor === null) return;
    editor.goToPosition(line - 1, column !== undefined ? column - 1 : 0);
}
