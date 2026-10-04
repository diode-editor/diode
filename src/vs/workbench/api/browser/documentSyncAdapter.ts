import type { IModelContentChangedEvent } from "../../../editor/common/model/iDocumentContentChange.ts";
import type { BaseTextEditorModel } from "../../common/editor/textEditorModel.ts";
import type { IEditorGroupsService } from "../../services/editor/common/editorGroupsService.ts";
import type { IEditorService } from "../../services/editor/common/editorService.ts";
import type { IDocumentSyncTarget } from "../common/iDocumentSyncTarget.ts";
import type { IWireDocumentChangedEvent, IWireDocumentSyncSnapshot } from "../common/wireTypes.ts";

/** Снапшот документа модели для document sync push'а (`editor.didOpen`/`didChange`). */
export function documentSyncSnapshotOfModel(model: BaseTextEditorModel): IWireDocumentSyncSnapshot {
    return {
        uri: model.uri.toString(),
        languageId: model.languageId,
        version: model.document.versionId,
        text: model.getText(),
        isDirty: model.isModified,
    };
}

/**
 * Батч правок модели в проводной форме `editor.didChange`: правки как есть (в
 * порядке применения), версия модели после батча.
 */
export function documentChangedEventOfModel(
    model: BaseTextEditorModel,
    event: IModelContentChangedEvent,
): IWireDocumentChangedEvent {
    return {
        uri: model.uri.toString(),
        version: event.versionId,
        changes: event.changes.map(({ range, text }) => ({
            range: {
                startLine: range.start.line,
                startCharacter: range.start.character,
                endLine: range.end.line,
                endCharacter: range.end.character,
            },
            text,
        })),
        isDirty: model.isModified,
    };
}

/**
 * Снапшоты ВСЕХ открытых документов (по одному на модель — документ в двух
 * группах не дублируется). Хост пушит их как `editor.didOpen` на `host.ready`,
 * чтобы `workspace.textDocuments` был полон ДО активации расширений (стоковый
 * vscode-languageclient читает его на `start()`).
 */
export function openDocumentSnapshots(group: IEditorService): IWireDocumentSyncSnapshot[] {
    const snapshots: IWireDocumentSyncSnapshot[] = [];
    const seen = new Set<BaseTextEditorModel>();
    for (const editor of group.getTextSurfaces()) {
        if (seen.has(editor.model)) continue;
        seen.add(editor.model);
        snapshots.push(documentSyncSnapshotOfModel(editor.model));
    }
    return snapshots;
}

/**
 * Продюсер document sync (core → host), пер-ДОКУМЕНТНЫЙ (AS-11): `didOpen` на
 * первое открытие ресурса, `didChange` на правку его модели — в какой бы группе
 * (и активна ли она) правка ни случилась; `didClose` — когда закрыта последняя
 * вкладка документа. Подписка на МОДЕЛЬ, не на вкладку: документ в двух группах
 * даёт один didChange, а не два. Документы — всех текстовых поверхностей
 * (`getTextSurfaces`): вкладок и сторон дифф-вкладок, по которым тоже зовут
 * провайдеров. Панели Output — нет: их содержимое — лог, в том числе канал
 * «Extension Host (RPC)», и каждая его строка, уехав субпроцессу правкой,
 * порождала бы новую строку того же канала. didChange — дельта: точные правки батча
 * модели (`onDidChangeModelContent`), а не полный текст; полный снапшот — только
 * на открытии и на замене содержимого целиком (flush).
 */
export function bindDocumentSync(group: IEditorService, groups: IEditorGroupsService, host: IDocumentSyncTarget): void {
    /** Живые подписки по модели; смерть последней вкладки снимает и шлёт didClose. */
    const tracked = new Map<BaseTextEditorModel, { dispose(): void }>();

    const trackModel = (model: BaseTextEditorModel): void => {
        if (tracked.has(model)) return;
        host.didOpenTextDocument(documentSyncSnapshotOfModel(model));
        tracked.set(
            model,
            // Батч модели — сразу, без коалесинга: запрос провайдера, ушедший
            // следом, едет по тому же каналу ПОСЛЕ правки (порядок сообщений
            // заменяет версию в запросе, как у `$acceptModelChanged` эталона).
            model.document.onDidChangeModelContent((event) => {
                if (event.isFlush) host.didChangeTextDocument(documentSyncSnapshotOfModel(model));
                else host.didChangeTextDocumentContent(documentChangedEventOfModel(model, event));
            }),
        );
    };

    /** Согласует множество отслеживаемых моделей с открытыми вкладками. */
    const reconcile = (): void => {
        const alive = new Set<BaseTextEditorModel>();
        for (const editor of group.getTextSurfaces()) alive.add(editor.model);
        for (const [model, subscription] of [...tracked]) {
            if (alive.has(model)) continue;
            subscription.dispose();
            tracked.delete(model);
            host.didCloseTextDocument(model.uri.toString());
        }
        for (const model of alive) trackModel(model);
    };

    // Открытия/закрытия вкладок любой группы + структурные изменения полосы.
    group.onDidChangeEditors(reconcile);
    // Структура полосы без смены вкладок набор документов не меняет (перенос и
    // слияние вкладок приходят через onDidChangeEditors) — подписка страхует.
    // Stryker disable next-line CallExpression: эквивалентен — см. выше
    groups.onDidGroupsChange(reconcile);
    reconcile();
}
