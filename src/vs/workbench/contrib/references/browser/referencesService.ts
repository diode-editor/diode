import { LatestRequest } from "../../../../base/common/cancellation.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { findWordRangeAt } from "../../../../editor/common/core/wordClassification.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import { IFileServiceDIToken } from "../../../../platform/files/common/files.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import {
    type TextFileModelService,
    TextFileModelServiceDIToken,
} from "../../../services/textfile/common/textFileModelService.ts";

import { getReferences } from "./getReferences.ts";
import { buildReferenceGroups, type IReferenceTextSource } from "./referencePreview.ts";
import type { ReferencesComponent } from "./referencesComponent.ts";
import { REFERENCES_VIEWLET_ID, ReferencesComponentDIToken } from "./referencesComponent.ts";

export const ReferencesServiceDIToken = token<ReferencesService>("ReferencesService");

/** Отмены RPC нет: от устаревших ответов защищает счётчик запросов (как в `CompletionService`/`HoverService`). */
export class ReferencesService {
    public static dependencies = [
        ReferencesComponentDIToken,
        EditorServiceDIToken,
        TextFileModelServiceDIToken,
        IWorkspaceContextServiceDIToken,
        IFileServiceDIToken,
        SidebarServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    private readonly latest = new LatestRequest();

    private readonly textSource: IReferenceTextSource;

    public constructor(
        private readonly component: ReferencesComponent,
        private readonly group: IEditorService,
        models: TextFileModelService,
        private readonly workspaceContext: IWorkspaceContextService,
        providers: IFileService,
        private readonly sidebarService: SidebarService,
        private readonly languageFeatures: ILanguageFeaturesService,
    ) {
        this.textSource = {
            // Открытая модель — источник правды для открытых файлов: в ней видны
            // несохранённые правки, которые сервер тоже видит через didChange.
            openText: (uri: Uri) => models.get(uri)?.getText() ?? null,
            readText: async (uri: Uri) => new TextDecoder().decode((await providers.readFile(uri)).value),
        };
    }

    /** Каретка не на слове — ничего не делаем: пустая панель ничего бы не объяснила. */
    public async findReferences(): Promise<void> {
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        // Провайдеров для документа нет — панель «No results» соврала бы:
        // ссылки никто и не искал (у vscode команду гасит `editorHasReferenceProvider`).
        const registry = this.languageFeatures.referenceProvider;
        if (!registry.has(editor)) return;

        const caret = editor.viewState.selections[0].active;
        const text = editor.getText();
        if (!isOnWord(text, caret.line, caret.character)) return;

        const ticket = this.latest.start();
        const references = await getReferences(
            registry,
            editor,
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId: editor.model.document.versionId,
                line: caret.line,
                character: caret.character,
                // VS Code показывает объявление первой строкой списка.
                includeDeclaration: true,
            },
            // Clear и повторный поиск отменяют запрос и у провайдера.
            ticket.token,
        );
        if (ticket.isStale()) return;

        // `folders.at(0)` — видимое сужение до однопапочной семантики (мульти-рут — этап C в
        // docs/TODO/MultiRoot.md).
        // Stryker disable next-line StringLiteral: корень без открытой папки — любая строка, не являющаяся префиксом пути ссылки, даёт тот же результат (путь показывается целиком)
        const root = this.workspaceContext.getWorkspace().folders.at(0)?.uri.fsPath ?? "";
        const groups = await buildReferenceGroups(references, this.textSource, root);
        if (ticket.isStale()) return;

        this.component.setResults(groups);
        this.sidebarService.showViewlet(REFERENCES_VIEWLET_ID);
    }

    public clear(): void {
        // Ответ уже отправленного запроса не должен наполнить очищенную панель.
        this.latest.cancel();
        this.component.clear();
    }
}

function isOnWord(text: string, line: number, character: number): boolean {
    const lineText = text.split("\n").at(line);
    if (lineText === undefined) return false;
    return findWordRangeAt(lineText, character) !== null;
}
