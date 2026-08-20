import type { IDisposable } from "@tuidom/core/common/disposable";

import { Uri } from "../vs/base/common/uri.ts";
import type {
    IHistoryEditor,
    IHistoryEditorGroup,
    IHistoryEditorSource,
} from "../vs/workbench/services/history/browser/historyService.ts";

/** Документ без известного числа строк: `goToPosition` не клампит. */
const UNBOUNDED = Number.MAX_SAFE_INTEGER;

/** Открытая «вкладка» фейка: ресурс + каретка. */
class FakeHistoryPane implements IHistoryEditor {
    public line = 0;
    public character = 0;

    public constructor(
        public readonly uri: Uri,
        private readonly lineCount: number,
        private readonly onMove: (pane: FakeHistoryPane) => void,
    ) {}

    public get primaryCursorLine(): number {
        return this.line;
    }

    public get primaryCursorColumn(): number {
        return this.character;
    }

    /** Как у настоящей панели — клампит строку к границам документа. */
    public goToPosition(line: number, column = 0): void {
        this.line = Math.min(line, this.lineCount - 1);
        this.character = column;
        this.onMove(this);
    }
}

class FakeHistoryGroup implements IHistoryEditorGroup {
    public readonly panes: FakeHistoryPane[] = [];
    public active: FakeHistoryPane | null = null;

    public constructor(public readonly id: number) {}

    public getPanes(): readonly FakeHistoryPane[] {
        return this.panes;
    }
}

/**
 * Фейковая полоса групп для юнитов `HistoryService`: воспроизводит ровно те
 * повадки `EditorService`, от которых зависит история, — синхронные события
 * смены активного редактора и перемещения каретки, идентичность вкладки по
 * ресурсу и отказ открыть закрытый не-`file:` ресурс (настоящий `openUri`
 * уходит в `TextFileModel.openFile`, который на такой схеме бросает).
 */
export class FakeHistoryEditorSource implements IHistoryEditorSource {
    /** Известное число строк по ресурсу — для проверки клампа `goToPosition`. */
    public readonly lineCounts = new Map<string, number>();
    /** Ресурсы, прошедшие через {@link openUri}, в порядке вызовов. */
    public readonly openUriCalls: string[] = [];
    /** Группы, запрошенные через {@link focusGroup}, в порядке вызовов. */
    public readonly focusGroupCalls: number[] = [];

    private readonly groupList: FakeHistoryGroup[] = [new FakeHistoryGroup(1)];
    private activeGroupValue: FakeHistoryGroup = this.groupList[0];
    private readonly activeListeners = new Set<(editor: IHistoryEditor | null) => void>();
    private readonly selectionListeners = new Set<(editor: IHistoryEditor) => void>();

    public get groups(): readonly IHistoryEditorGroup[] {
        return this.groupList;
    }

    public get activeGroup(): IHistoryEditorGroup {
        return this.activeGroupValue;
    }

    public getActiveEditor(): IHistoryEditor | null {
        return this.activeGroupValue.active;
    }

    public openUri(uri: Uri): void {
        this.openUriCalls.push(uri.toString());
        const existing = this.findPane(this.activeGroupValue, uri.toString());
        if (existing === null && uri.scheme !== "file") {
            throw new Error(`openUri: ресурс ${uri.toString()} закрыт и не восстановим`);
        }
        this.activate(existing ?? this.insertPane(uri));
    }

    public focusGroup(id: number): void {
        this.focusGroupCalls.push(id);
        for (const group of this.groupList) {
            if (group.id !== id) continue;
            this.activeGroupValue = group;
            this.fireActive(group.active);
        }
    }

    public onActiveEditorChanged(listener: (editor: IHistoryEditor | null) => void): IDisposable {
        this.activeListeners.add(listener);
        return {
            dispose: () => {
                this.activeListeners.delete(listener);
            },
        };
    }

    public onDidChangeActiveEditorSelection(listener: (editor: IHistoryEditor) => void): IDisposable {
        this.selectionListeners.add(listener);
        return {
            dispose: () => {
                this.selectionListeners.delete(listener);
            },
        };
    }

    // ─── Управление из теста ──────────────────────────────────

    /** Открывает ресурс в активной группе — в обход гейта схемы у {@link openUri}. */
    public open(uri: string): void {
        this.activate(this.findPane(this.activeGroupValue, uri) ?? this.insertPane(Uri.parse(uri)));
    }

    /** Двигает каретку активного редактора — как это делает пользователь. */
    public moveCaret(line: number, character = 0): void {
        this.activeGroupValue.active?.goToPosition(line, character);
    }

    /** Закрывает вкладку ресурса в активной группе. */
    public close(uri: string): void {
        const group = this.activeGroupValue;
        const index = group.panes.findIndex((pane) => pane.uri.toString() === uri);
        const wasActive = group.active === group.panes[index];
        group.panes.splice(index, 1);
        if (!wasActive) return;
        group.active = group.panes[group.panes.length - 1] ?? null;
        this.fireActive(group.active);
    }

    /** Заводит вторую группу и делает её активной. */
    public addGroup(id: number): void {
        const group = new FakeHistoryGroup(id);
        this.groupList.push(group);
        this.activeGroupValue = group;
        this.fireActive(null);
    }

    /** Убирает группу из полосы (её вкладки исчезают вместе с ней). */
    public removeGroup(id: number): void {
        const index = this.groupList.findIndex((group) => group.id === id);
        this.groupList.splice(index, 1);
        this.activeGroupValue = this.groupList[0];
    }

    /** Позиция каретки активного редактора — `null`, если редактора нет. */
    public caret(): { uri: string; line: number; character: number } | null {
        const active = this.activeGroupValue.active;
        if (active === null) return null;
        return { uri: active.uri.toString(), line: active.line, character: active.character };
    }

    // ─── Внутреннее ───────────────────────────────────────────

    private findPane(group: FakeHistoryGroup, uri: string): FakeHistoryPane | null {
        return group.panes.find((pane) => pane.uri.toString() === uri) ?? null;
    }

    private insertPane(uri: Uri): FakeHistoryPane {
        const pane = new FakeHistoryPane(uri, this.lineCounts.get(uri.toString()) ?? UNBOUNDED, (moved) =>
            this.fireSelection(moved),
        );
        this.activeGroupValue.panes.push(pane);
        return pane;
    }

    private activate(pane: FakeHistoryPane): void {
        this.activeGroupValue.active = pane;
        this.fireActive(pane);
    }

    private fireActive(editor: IHistoryEditor | null): void {
        for (const listener of [...this.activeListeners]) listener(editor);
    }

    private fireSelection(editor: IHistoryEditor): void {
        for (const listener of [...this.selectionListeners]) listener(editor);
    }
}
