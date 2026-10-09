import { vi } from "vitest";

import { Uri } from "../vs/base/common/uri.ts";
import { ContextKeyService } from "../vs/platform/contextkey/common/contextKeyService.ts";
import type { IFileContent, IFileService } from "../vs/platform/files/common/files.ts";
import type { ILogService } from "../vs/platform/log/common/iLogService.ts";
import type {
    IWorkspaceContextService,
    IWorkspaceFolder,
} from "../vs/platform/workspace/common/iWorkspaceContextService.ts";
import type {
    QuickInputService,
    QuickPickOptions,
} from "../vs/workbench/browser/parts/quickinput/quickInputService.ts";
import { makeViewsHarness } from "../vs/workbench/browser/parts/views/viewsService.testUtils.ts";
import type { QuickPickItem } from "../vs/workbench/common/quickPickItem.ts";
import { TaskService } from "../vs/workbench/contrib/tasks/browser/taskService.ts";
import { TerminalService } from "../vs/workbench/contrib/terminal/browser/terminalService.ts";
import type { DialogService } from "../vs/workbench/services/dialogs/browser/dialogService.ts";
import type { IEditorService } from "../vs/workbench/services/editor/common/editorService.ts";
import type { LayoutService } from "../vs/workbench/services/layout/browser/layoutService.ts";
import { NotificationService } from "../vs/workbench/services/notification/browser/notificationService.ts";
import type { OutputService } from "../vs/workbench/services/output/common/outputService.ts";

import { FakeTerminalSurface } from "./FakeTerminalSurface.ts";
import { TASK_FOLDER } from "./taskFixtures.ts";
import { createTestConfigurationService } from "./testConfigurationService.ts";
import { createLoggerSpy } from "./themeExtensionFixture.ts";

export interface ITaskServiceHarnessOptions {
    readonly settings?: Readonly<Record<string, unknown>>;
    /** Текст `.vscode/tasks.json`; `undefined` — файла нет. */
    readonly tasksJson?: string;
    /** Папка воркспейса; `null` — окно без папки. */
    readonly folder?: IWorkspaceFolder | null;
}

/**
 * Сервис задач поверх настоящего TerminalService с фейковыми сессиями и
 * фейковыми краями: ФС (tasks.json), редакторы, диалог, пикер. Пикер
 * отвечает по сценарию `answerPicks` — строкой с такой подписью (`undefined` — отмена).
 */
export function buildTaskServiceHarness(options: ITaskServiceHarnessOptions = {}) {
    const views = makeViewsHarness();
    const sessions: FakeTerminalSurface[] = [];
    let nextPid = 100;
    const terminals = new TerminalService(
        views.panelService,
        views.service,
        createTestConfigurationService({}),
        (o) => {
            const session = new FakeTerminalSurface(o.shell ?? "/bin/sh", nextPid++);
            sessions.push(session);
            return session;
        },
    );
    views.service.attachRegisteredContainers();
    const configuration = createTestConfigurationService(options.settings ?? {});
    let tasksJson = options.tasksJson;
    const readFile = vi.fn((uri: Uri): Promise<IFileContent> => {
        if (tasksJson === undefined) return Promise.reject(new Error(`ENOENT ${uri.fsPath}`));
        return Promise.resolve({ value: new TextEncoder().encode(tasksJson) } as IFileContent);
    });
    const folder = options.folder === null ? undefined : (options.folder ?? TASK_FOLDER);
    const workspace = {
        getWorkspace: () => ({ id: folder === undefined ? null : "ws", folders: folder === undefined ? [] : [folder] }),
    } as unknown as IWorkspaceContextService;
    let dirty: unknown[] = [];
    let activeEditor: { uri: Uri; primaryCursorLine: number } | null = null;
    const saveAll = vi.fn(() => Promise.resolve());
    const editors = {
        getActiveTabEditor: () => activeEditor,
        collectDirty: () => dirty,
        saveAll,
    } as unknown as IEditorService;
    const confirm = vi.fn(() => Promise.resolve(true));
    const dialogs = { confirm } as unknown as DialogService;
    const notifications = new NotificationService();
    const picks: QuickPickOptions[] = [];
    const answers: (string | undefined)[] = [];
    const quickPick = vi.fn((opts: QuickPickOptions): Promise<QuickPickItem | undefined> => {
        picks.push(opts);
        const label = answers.shift();
        return Promise.resolve(label === undefined ? undefined : opts.items.find((item) => item.label === label));
    });
    const quickInput = { quickPick } as unknown as QuickInputService;
    const contextKeys = new ContextKeyService();
    const logger = createLoggerSpy();
    const logService = { createLogger: () => logger } as unknown as ILogService;
    const output = { showChannel: vi.fn<(id: string) => void>() };
    const layout = { setPanelVisible: vi.fn<(visible: boolean) => void>() };
    const service = new TaskService(
        terminals,
        views.panelService,
        () => "/bin/bash",
        configuration,
        workspace,
        { readFile } as unknown as IFileService,
        editors,
        dialogs,
        notifications,
        quickInput,
        contextKeys,
        logService,
        output as unknown as OutputService,
        layout as unknown as LayoutService,
    );
    return {
        output,
        layout,
        views,
        terminals,
        sessions,
        configuration,
        readFile,
        saveAll,
        confirm,
        notifications,
        picks,
        quickInput,
        quickPick,
        contextKeys,
        logger,
        service,
        /** Ответы пикера по порядку показов: подпись строки или `undefined` (Escape). */
        answerPicks: (...labels: (string | undefined)[]): void => {
            answers.push(...labels);
        },
        setTasksJson: (text: string | undefined): void => {
            tasksJson = text;
        },
        setDirty: (items: unknown[]): void => {
            dirty = items;
        },
        setActiveEditor: (path: string | null, line = 0): void => {
            activeEditor =
                path === null
                    ? null
                    : { uri: path.includes(":") ? Uri.parse(path) : Uri.file(path), primaryCursorLine: line };
        },
        /** Подписи строк последнего показанного пикера. */
        lastPickLabels: (): string[] => (picks.at(-1)?.items ?? []).map((item) => item.label),
        dispose: (): void => {
            service.dispose();
            terminals.dispose();
        },
    };
}

/** tasks.json из списка задач. */
export function tasksJsonOf(tasks: readonly Record<string, unknown>[]): string {
    return JSON.stringify({ version: "2.0.0", tasks });
}
