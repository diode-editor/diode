import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { DiffEditorPane } from "../../../browser/parts/editor/diffEditorPane.ts";
import { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { FileSystemProviderRegistryDIToken } from "../../../common/coreTokens.ts";
import {
    LanguageServiceDIToken,
    TokenizationRegistryDIToken,
    TokenStyleResolverDIToken,
} from "../../../common/coreTokens.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import { OriginalResourceProviderDIToken } from "./quickDiffService.ts";

/** Схема вкладки диффа: не ресурс на диске, а пара «файл ↔ ревизия». */
const DIFF_SCHEME = "vexx-diff";

/** Сколько держать сообщение о том, что сравнивать не с чем. */
export const COMPARE_NOTICE_MS = 4000;

/** `"no-original"` = сравнивать не с чем; реакцию (notice, открыть файл) выбирает вызывающий. */
export type OpenDiffResult = "opened" | "no-original";

/**
 * Ядро «сравнить с HEAD»: открывает вкладку inline-диффа для произвольного uri,
 * не требуя активного редактора. Оригинал даёт SCM-расширение
 * (`IOriginalResourceProvider`) через реестр провайдеров ФС; modified-сторона —
 * открытый буфер этого uri (несохранённые правки видны), а без него — снимок с
 * диска через `file:`-провайдер; файл, не читающийся с диска (удалён, status D),
 * даёт дифф «HEAD ↔ пусто». Дифф считает перенесённый движок, отображение
 * собирает `DiffViewModel`, вкладкой это становится благодаря абстракции панели.
 *
 * Дифф — **снимок** на момент вызова: панель держит тексты у себя. Живой
 * пересчёт по правкам исходного буфера — отдельная задача (docs/TODO/Diff.md).
 */
export async function openDiffWithHead(accessor: ServiceAccessor, uri: Uri): Promise<OpenDiffResult> {
    const editors = accessor.get(EditorServiceDIToken);

    const originalText = await readOriginal(accessor, uri);
    if (originalText === null) return "no-original";

    const pane = editors
        .getPanes()
        .find((p): p is TextEditorPane => p instanceof TextEditorPane && p.uri.toString() === uri.toString());

    let modifiedText: string;
    if (pane) {
        modifiedText = pane.getText();
    } else {
        try {
            const bytes = await accessor.get(FileSystemProviderRegistryDIToken).readFile(uri);
            modifiedText = new TextDecoder().decode(bytes);
        } catch {
            modifiedText = "";
        }
    }

    const languageId =
        pane?.languageId ?? accessor.get(LanguageServiceDIToken).getLanguageIdForResource(uri.fsPath) ?? "plaintext";
    const label = pane ? editors.displayName(pane) : uri.path.slice(uri.path.lastIndexOf("/") + 1);

    const input = {
        uri: Uri.from({ scheme: DIFF_SCHEME, path: uri.path, query: "HEAD" }),
        label: `${label} ↔ HEAD`,
        originalText,
        modifiedText,
        languageId,
    };

    // Дифф — снимок, а идентичность вкладки (`vexx-diff:<path>?HEAD`) от содержимого
    // не зависит: группа дедупит её по `uri`. Поэтому если вкладка того же ресурса
    // уже открыта, обновляем её свежим снимком на месте — иначе повторный вызов
    // (единственный способ «обновить» дифф) вернул бы устаревший результат.
    const existing = editors.getPanes().find((p) => p.uri.toString() === input.uri.toString());
    if (existing instanceof DiffEditorPane) {
        existing.setInput(input);
        editors.activateTab(editors.getPanes().indexOf(existing));
        return "opened";
    }

    editors.openPane(
        new DiffEditorPane(accessor.get(TokenizationRegistryDIToken), accessor.get(TokenStyleResolverDIToken), input),
    );
    return "opened";
}

/** Текст версии из git, либо `null`, если сравнивать не с чем. */
async function readOriginal(accessor: ServiceAccessor, uri: Uri): Promise<string | null> {
    try {
        const original = await accessor.get(OriginalResourceProviderDIToken).provideOriginalResource(uri);
        if (original === null) return null;
        const providers = accessor.get(FileSystemProviderRegistryDIToken);
        if (!providers.hasProvider(original.scheme)) return null;
        return new TextDecoder().decode(await providers.readFile(original));
    } catch {
        return null;
    }
}

/** Палитра: сравнивает активный файл; без активного редактора — тихий no-op. */
async function compareWithHead(accessor: ServiceAccessor): Promise<void> {
    const editors = accessor.get(EditorServiceDIToken);
    const editor = editors.getActiveEditor();
    if (editor === null) return;

    const result = await openDiffWithHead(accessor, editor.uri);
    if (result === "no-original") {
        // Untracked, вне репозитория, git недоступен, SCM-расширение не поднялось —
        // для пользователя всё это одно и то же: сравнивать не с чем.
        const handle = accessor.get(StatusBarServiceDIToken).addEntry({
            id: "scm.compare.notice",
            text: "No changes to compare: the file has no version in git",
            alignment: "left",
            priority: 100,
        });
        setTimeout(() => {
            handle.dispose();
        }, COMPARE_NOTICE_MS);
    }
}

export const compareWithHeadAction: CommandAction = {
    id: "vexx.scm.compareWithHead",
    title: "Git: Compare Active File with HEAD",
    run(accessor) {
        void compareWithHead(accessor);
    },
};
