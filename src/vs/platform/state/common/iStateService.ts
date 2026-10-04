import type { Event } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";

/**
 * Сервис машинного состояния UI/сессии — аналог `IStorageService` / `Memento`
 * из VS Code. **Отдельная система от {@link IConfigurationService}:** настройки
 * (`settings.json`) человекочитаемы (JSONC, комментарии), а состояние машинное
 * (plain JSON, никто не редактирует руками). Подробности — docs/arch/State.md.
 *
 * Хранит открытые файлы, ширину/видимость панелей и т.п. по областям видимости
 * ({@link StateScope}). Значения объявляются {@link IStateDescriptor} — это и есть
 * «инструкция», какие свойства у каждого состояния.
 */
export interface IStateService {
    /**
     * Возвращает сохранённое значение или `descriptor.default`, если ключа нет
     * (или файл был битый). Результат изолирован от внутреннего стора (глубокая
     * копия) — мутация возвращённого объекта не затрагивает хранилище.
     */
    get<T>(descriptor: IStateDescriptor<T>): T;

    /**
     * Пишет значение в in-memory стор **синхронно** и планирует debounced-запись
     * на диск. Значение копируется — последующая мутация переданного объекта не
     * попадает в стор. Реальная durability гарантируется {@link flushSync} на
     * выходе процесса.
     */
    store<T>(descriptor: IStateDescriptor<T>, value: T): void;

    /**
     * Удаляет ключ из стора (вместе с записью версии): следующий `get` отдаст
     * дефолт, а файл не копит пустышки. Запись на диск — как у {@link store}.
     */
    remove<T>(descriptor: IStateDescriptor<T>): void;

    /**
     * Открывает (или переключает) стор `workspace`-scope на проект
     * `workspaceId`. Предыдущий workspace-стор сначала синхронно сбрасывается
     * на диск. Пока воркспейс не открыт, `workspace`-дескрипторы обслуживает
     * стор пустого окна (`EMPTY_WINDOW_WORKSPACE_ID`), а не `global`.
     *
     * Аргумент — идентичность проекта, а не путь папки: см.
     * `resolveWorkspaceStorageDir`.
     */
    openWorkspace(workspaceId: WorkspaceId): void;

    /**
     * Стор `workspace`-scope переключён на проект ({@link openWorkspace}) —
     * аналог `IStorageService.onDidChangeTarget` VS Code. Синхронно, уже после
     * загрузки нового стора: подписчик читает состояние проекта, а не пустого
     * окна. Стор пустого окна, открытый на старте, события не даёт.
     */
    readonly onDidOpenWorkspace: Event<WorkspaceId>;

    /**
     * Синхронно записывает все «грязные» сторы на диск. Безопасно вызывать в
     * обработчике `process.on("exit")` (только синхронный I/O).
     */
    flushSync(): void;
}

/** Область видимости состояния. */
export type StateScope =
    /** Per-profile: `<profileDir>/globalState.json`. Fallback, когда проект не открыт. */
    | "global"
    /** Per-project: `workspaceStorage/<workspaceId>/state.json`. */
    | "workspace";

/**
 * Дескриптор одного сохраняемого состояния. Объявляется рядом с
 * контроллером-владельцем (не с TUIDom-элементом — тот не знает про
 * Configuration); агрегируются в `Workbench/Services/StateKeys.ts`.
 */
export interface IStateDescriptor<T> {
    /** Ключ в сторе, namespaced в стиле VS Code (`"workbench.sideBar.width"`). */
    readonly key: string;
    /** Где хранится. */
    readonly scope: StateScope;
    /** Значение при первом запуске / битом файле. */
    readonly default: T;
    /**
     * Версия формы значения. Если задана вместе с {@link migrate}, стор запоминает
     * версию записи и при чтении устаревшей формы прогоняет `migrate`.
     */
    readonly version?: number;
    /**
     * Миграция значения старой формы к текущей. `from` — версия, под которой
     * значение было записано (0, если версия неизвестна).
     */
    readonly migrate?: (raw: unknown, from: number) => T;
}

/** DI-токен машинного состояния UI/сессии ({@link IStateService}, см. docs/arch/State.md). */
// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const StateServiceDIToken = token<IStateService>("StateService");
