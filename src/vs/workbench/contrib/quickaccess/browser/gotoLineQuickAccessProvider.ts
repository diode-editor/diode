import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import { parseGotoLineQuery } from "./quickOpenParsing.ts";

/**
 * The active editor as seen by Go-to-Line. Structurally satisfied by
 * editor pane; kept as a narrow interface so the provider does not depend
 * on the whole editor. All values are 0-based (document coordinates).
 */
export interface IGotoLineEditor {
    readonly lineCount: number;
    readonly primaryCursorLine: number;
    readonly primaryCursorColumn: number;
    goToPosition(line: number, column?: number): void;
}

/**
 * Источник активного редактора для Go-to-Line (`:`-режим и `file:line`).
 * Интерфейсный шов: `EditorService` соответствует ему
 * структурно; биндинг — в `Workbench/Modules/WorkbenchModule.ts`. Читается
 * лениво — accept `file:line` берёт редактор *после* открытия файла, так что
 * прыжок происходит в свежеактивированном редакторе.
 */
export interface IGotoLineEditorSource {
    getActiveEditor(): IGotoLineEditor | null;
}

export const GotoLineEditorSourceDIToken = token<IGotoLineEditorSource>("GotoLineEditorSource");

export const GotoLineQuickAccessProviderDIToken = token<GotoLineQuickAccessProvider>("GotoLineQuickAccessProvider");

/**
 * Go-to-Line (`:`): единственная строка — actionable «Go to line N», как
 * только набран номер, иначе информационный хинт. VS Code показывает ту же
 * однострочную аффордансу вместо списка.
 */
export class GotoLineQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = ":";

    public static dependencies = [GotoLineEditorSourceDIToken, JumpRecorderDIToken] as const;

    public constructor(
        private readonly editorSource: IGotoLineEditorSource,
        private readonly jumps: IJumpRecorder,
    ) {}

    /** VS Code-style hint for Go-to-Line mode, showing the current position. */
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
 * Jumps the active editor to a 1-based line/column, converting to 0-based.
 * Re-reads the active editor at accept time: it may have vanished — or, for
 * `file:line`, may have just been opened by the accept itself.
 *
 * `jumps` оборачивает переход целиком (открытие файла — тоже внутри, см.
 * `filesQuickAccessProvider`), чтобы история навигации получила ровно две
 * записи: точку, откуда прыгнули, и цель.
 */
export function navigateActiveEditor(source: IGotoLineEditorSource, line: number, column: number | undefined): void {
    const editor = source.getActiveEditor();
    if (editor === null) return;
    editor.goToPosition(line - 1, column !== undefined ? column - 1 : 0);
}
