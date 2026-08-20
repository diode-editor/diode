import * as nodePath from "node:path";

import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { FileSearchResult, FileSearchService } from "../../../services/search/node/fileSearchService.ts";
import { FileSearchServiceDIToken } from "../../../services/search/node/fileSearchService.ts";
import type { IQuickAccessProvider, QuickAccessItem } from "../common/iQuickAccessProvider.ts";

import type { IGotoLineEditorSource } from "./gotoLineQuickAccessProvider.ts";
import { GotoLineEditorSourceDIToken, navigateActiveEditor } from "./gotoLineQuickAccessProvider.ts";
import type { ParsedGoto } from "./quickOpenParsing.ts";
import { splitFileQuery } from "./quickOpenParsing.ts";

export const FilesQuickAccessProviderDIToken = token<FilesQuickAccessProvider>("FilesQuickAccessProvider");

/**
 * Дефолтный (файловый) провайдер Quick Open: fuzzy-поиск поверх
 * {@link FileSearchService} с поддержкой суффикса `file:line[:col]`. Индекс
 * строится в фоне — пока показ открыт, провайдер живо обновляет список по мере
 * роста индекса; ввод дорогой, поэтому запросы дебаунсятся (`debounceQuery`).
 */
export class FilesQuickAccessProvider implements IQuickAccessProvider {
    public static readonly PREFIX = "";

    public static dependencies = [
        FileSearchServiceDIToken,
        CommandRegistryDIToken,
        GotoLineEditorSourceDIToken,
        JumpRecorderDIToken,
    ] as const;

    public readonly debounceQuery = true;

    public constructor(
        private readonly fileSearch: FileSearchService,
        private readonly commands: CommandRegistry,
        private readonly editorSource: IGotoLineEditorSource,
        private readonly jumps: IJumpRecorder,
    ) {}

    public getPlaceholder(): string {
        return "Go to File...";
    }

    public onShow(refresh: (preserveSelection: boolean) => void): void {
        // Kick a throttled background re-index and refresh the list live as
        // it grows (the index builds in the background, not on a watcher).
        this.fileSearch.refreshIfStale();
        this.fileSearch.onIndexChanged = () => {
            // The list grew in the background for the same query — refresh the
            // results without resetting the cursor the user is navigating.
            refresh(true);
        };
    }

    public onHide(): void {
        this.fileSearch.onIndexChanged = null;
    }

    public getItems(query: string): QuickAccessItem[] {
        const { filePart, goto } = splitFileQuery(query);
        return this.buildFileItems(this.fileSearch.search(filePart, 50), goto);
    }

    private buildFileItems(results: FileSearchResult[], goto: ParsedGoto | null): QuickAccessItem[] {
        return results.map((r) => {
            const basename = nodePath.basename(r.entry.relativePath);
            const dir = nodePath.dirname(r.entry.relativePath);

            // Split matchedIndices into basename vs. directory ranges for highlighting
            const basenameOffset = r.entry.relativePath.length - basename.length;
            const labelRanges: [number, number][] = [];
            const descRanges: [number, number][] = [];

            for (const idx of r.matchedIndices) {
                if (idx >= basenameOffset) {
                    const localIdx = idx - basenameOffset;
                    if (labelRanges.length > 0 && labelRanges[labelRanges.length - 1][1] === localIdx) {
                        labelRanges[labelRanges.length - 1][1]++;
                    } else {
                        labelRanges.push([localIdx, localIdx + 1]);
                    }
                } else {
                    if (descRanges.length > 0 && descRanges[descRanges.length - 1][1] === idx) {
                        descRanges[descRanges.length - 1][1]++;
                    } else {
                        descRanges.push([idx, idx + 1]);
                    }
                }
            }

            const absolutePath = r.entry.absolutePath;
            return {
                label: basename,
                description: dir === "." ? "" : dir,
                labelMatchRanges: labelRanges,
                descriptionMatchRanges: descRanges,
                accept: () => {
                    // Открытие и прыжок — один переход для истории навигации
                    // (иначе Back привёл бы в начало только что открытого файла).
                    this.jumps.jump(() => {
                        this.commands.execute("workbench.openFile", absolutePath);
                        // Read the active editor *after* the file opened above so a
                        // `file:line` accept jumps in the just-opened editor.
                        if (goto !== null) {
                            navigateActiveEditor(this.editorSource, goto.line, goto.column);
                        }
                    });
                },
            };
        });
    }
}
