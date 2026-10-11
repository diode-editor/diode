import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";

/**
 * Идентичность проекта — то, чем адресуются per-workspace сторы: каталог
 * `workspaceStorage/<id>/` (в нём `state.json` сессии и приватные каталоги
 * расширений, см. `resolveWorkspaceStorageDir`).
 *
 * id выводится из пути (`computeWorkspaceId` — `sha256(абсолютный путь)`):
 * у папки, открытой напрямую, — из пути папки, у воркспейса из файла
 * `.code-workspace` — из пути ФАЙЛА, поэтому два файла над одной папкой — два
 * разных проекта со своими сторами. **Вызывающие передают id, а не путь**:
 * когда «один проект» станет набором папок, меняется одна функция, а не три
 * места и раскладка у пользователей на диске.
 */
export type WorkspaceId = string;

/** Одна папка воркспейса (аналог `IWorkspaceFolder` VS Code). */
export interface IWorkspaceFolder {
    readonly uri: Uri;
    /** Отображаемое имя папки — базовое имя её пути. */
    readonly name: string;
    /** Позиция в `IWorkspace.folders`; стабильна до смены набора папок. */
    readonly index: number;
}

/** Открытый воркспейс (аналог `IWorkspace` VS Code). */
export interface IWorkspace {
    /**
     * Идентичность проекта или `null` для пустого окна (⇔ `folders` пуст ⇔
     * {@link WorkbenchState} `"empty"`). VS Code генерирует id и пустому окну,
     * мы — нет: без папки per-workspace стора нет вовсе (`state` падает в
     * global, `storageUri` расширений `undefined`), и заводить его тут значило
     * бы поменять наблюдаемое поведение. См. `docs/TODO/MultiRoot.md`.
     */
    readonly id: WorkspaceId | null;
    /**
     * Папки воркспейса. Форма — множественная (как в эталоне), семантика пока
     * **0-или-1**: мульти-рута у нас нет, поэтому здесь либо пустой массив,
     * либо ровно один элемент. Читатели, которым нужен «корень», берут
     * `folders.at(0)` — это видимое сужение, а не скрытое за геттером допущение.
     */
    readonly folders: readonly IWorkspaceFolder[];
    /**
     * Файл воркспейса `*.code-workspace`, если окно открыто через него
     * ({@link WorkbenchState} `"workspace"`); нет поля — папка открыта напрямую
     * или окно пустое. Папка у такого воркспейса тоже ровно одна
     * (`workspaceFile.ts`).
     */
    readonly configuration?: Uri;
}

/** Состояние окна (аналог `WorkbenchState` VS Code). */
export type WorkbenchState =
    /** Папка не открыта: Explorer рисует плейсхолдер, `workspaceFolders` расширений — `undefined`. */
    | "empty"
    /** Открыта одна папка напрямую. */
    | "folder"
    /**
     * Открыт файл воркспейса `*.code-workspace` (с одной папкой — мульти-рута
     * нет): настройки воркспейса — его блок `settings`, а `.diode/settings.json`
     * папки становится слоем папки.
     */
    | "workspace";

/**
 * Единственный источник правды о папках воркспейса (аналог
 * `IWorkspaceContextService` VS Code, `vs/platform/workspace/common/workspace.ts`).
 *
 * До него «корнем» владел приватный `rootPath` внутри `ExplorerService`, и
 * десять потребителей читали его через `getRootPath()` — каждая новая фича
 * добавляла одиннадцатый. Теперь корень спрашивают здесь; у Explorer'а остался
 * только корень его собственного дерева.
 *
 * Писателя в этом интерфейсе нет: набор папок ставит владелец
 * (`WorkbenchComponent.setWorkspaceFolder` через `WorkspaceContextService`),
 * остальные только читают.
 */
export interface IWorkspaceContextService {
    /** Текущий воркспейс: идентичность + папки. */
    getWorkspace(): IWorkspace;

    /** Состояние окна — производное от числа папок и файла воркспейса. */
    getWorkbenchState(): WorkbenchState;

    /**
     * Папка воркспейса, внутри которой лежит `resource`, либо `null` — ресурс
     * вне папок (или схема не `file`). Совпадение — по схеме и префиксу пути;
     * сама папка тоже считается «внутри себя», как в эталоне.
     */
    getWorkspaceFolder(resource: Uri): IWorkspaceFolder | null;

    /** Подписка на смену набора папок. Слушатель НЕ вызывается немедленно. */
    onDidChangeWorkspaceFolders(listener: () => void): IDisposable;
}
