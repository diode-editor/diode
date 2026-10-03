import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";

/**
 * Идентичность проекта — то, чем адресуются per-workspace сторы: каталог
 * `workspaceStorage/<id>/` (в нём `state.json` сессии и приватные каталоги
 * расширений, см. `resolveWorkspaceStorageDir`).
 *
 * Сегодня id выводится из единственной папки (`computeWorkspaceId` —
 * `sha256(абсолютный путь)`, формат на диске совпадает с VS Code), но
 * **вызывающие передают id, а не путь**: когда «один проект» станет набором
 * папок или файлом `.code-workspace`, меняется одна функция, а не три места и
 * раскладка у пользователей на диске.
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

/**
 * Открытый воркспейс (аналог `IWorkspace` VS Code, без `configuration` —
 * файлов `.code-workspace` у нас пока нет).
 */
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
}

/**
 * Состояние окна (аналог `WorkbenchState` VS Code без `workspace`-варианта:
 * файлов `.code-workspace` у нас нет, так что третьего состояния не бывает).
 */
export type WorkbenchState =
    /** Папка не открыта: Explorer рисует плейсхолдер, `workspaceFolders` расширений — `undefined`. */
    | "empty"
    /** Открыта одна папка. */
    | "folder";

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

    /** Состояние окна — производное от числа папок. */
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
