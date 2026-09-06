import type { Uri } from "../../../../base/common/uri.ts";
import { findWordRangeAt } from "../../../../editor/common/core/wordClassification.ts";
import type { IFileSystemProviderRegistry } from "../../../../platform/files/common/iFileSystemProviderRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";
import { FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { ExplorerService } from "../../files/browser/explorerService.ts";
import { ExplorerServiceDIToken } from "../../files/browser/explorerService.ts";

import { buildReferenceGroups, type IReferenceTextSource } from "./referencePreview.ts";
import type { ReferencesComponent } from "./referencesComponent.ts";
import { REFERENCES_VIEWLET_ID, ReferencesComponentDIToken } from "./referencesComponent.ts";

export const ReferencesServiceDIToken = token<ReferencesService>("ReferencesService");

/**
 * Find All References: спрашивает у провайдеров расширений
 * (`EditorService.referenceSource`) ссылки на символ под кареткой, добирает к
 * ним текст строк ({@link buildReferenceGroups}) и показывает вьюлет
 * REFERENCES.
 *
 * Сам поиск best-effort: отмены RPC у нас нет, поэтому от устаревших ответов
 * защищает счётчик запросов (как в `CompletionService`/`HoverService`) — пока
 * ходили за ссылками, пользователь мог запросить другой символ.
 */
export class ReferencesService {
    public static dependencies = [
        ReferencesComponentDIToken,
        EditorServiceDIToken,
        ExplorerServiceDIToken,
        FileSystemProviderRegistryDIToken,
        SidebarServiceDIToken,
    ] as const;

    /** Guard от устаревших ответов: пока ходили за ссылками, запрос мог смениться. */
    private requestSeq = 0;

    private readonly textSource: IReferenceTextSource;

    public constructor(
        private readonly component: ReferencesComponent,
        private readonly group: EditorService,
        private readonly explorerService: ExplorerService,
        providers: IFileSystemProviderRegistry,
        private readonly sidebarService: SidebarService,
    ) {
        this.textSource = {
            // Открытая модель — источник правды для открытых файлов: в ней видны
            // несохранённые правки, которые сервер тоже видит через didChange.
            openText: (uri: Uri) => this.group.openFileModel(uri)?.getText() ?? null,
            readText: async (uri: Uri) => new TextDecoder().decode(await providers.readFile(uri)),
        };
    }

    /**
     * Ищет ссылки на символ под кареткой и показывает их в сайдбаре. Каретка не
     * на слове — не делаем ничего: искать нечего, а пустая панель ничего бы не
     * объяснила.
     */
    public async findReferences(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const source = this.group.referenceSource;
        if (source === undefined) return;

        const caret = editor.viewState.selections[0].active;
        const text = editor.getText();
        // Каретка не на слове — искать нечего; сам текст слова панели не нужен,
        // это только гейт запроса.
        if (!isOnWord(text, caret.line, caret.character)) return;

        const seq = ++this.requestSeq;
        const references = await source({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text,
            line: caret.line,
            character: caret.character,
            // VS Code показывает объявление первой строкой списка.
            includeDeclaration: true,
        });
        if (seq !== this.requestSeq) return;

        const groups = await buildReferenceGroups(references, this.textSource, this.explorerService.getRootPath() ?? "");
        if (seq !== this.requestSeq) return;

        this.component.setResults(groups);
        this.sidebarService.showViewlet(REFERENCES_VIEWLET_ID);
    }

    /** Очищает панель (команда Clear). */
    public clear(): void {
        // Ответ уже отправленного запроса не должен наполнить очищенную панель.
        this.requestSeq++;
        this.component.clear();
    }
}

/** Стоит ли каретка на слове — гейт запроса (искать ссылки на пробел незачем). */
function isOnWord(text: string, line: number, character: number): boolean {
    const lineText = text.split("\n")[line];
    if (lineText === undefined) return false;
    return findWordRangeAt(lineText, character) !== null;
}
