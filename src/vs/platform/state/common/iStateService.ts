import type { Event } from "../../../base/common/event.ts";
import { token } from "../../instantiation/common/diContainer.ts";
import type { WorkspaceId } from "../../workspace/common/iWorkspaceContextService.ts";

/** Отдельно от {@link IConfigurationService}: состояние машинное, plain JSON, руками не правится (docs/arch/State.md). */
export interface IStateService {
    /** Глубокая копия: мутация результата стор не трогает. Битый файл — `descriptor.default`. */
    get<T>(descriptor: IStateDescriptor<T>): T;

    /** Стор обновляется синхронно, диск — debounced; durability — {@link flushSync} на выходе. Значение копируется. */
    store<T>(descriptor: IStateDescriptor<T>, value: T): void;

    /** Вместе с записью версии: файл не копит пустышки. */
    remove<T>(descriptor: IStateDescriptor<T>): void;

    /**
     * Предыдущий workspace-стор сначала синхронно сбрасывается на диск. До открытия
     * `workspace`-дескрипторы обслуживает стор пустого окна (`EMPTY_WINDOW_WORKSPACE_ID`), а не `global`.
     */
    openWorkspace(workspaceId: WorkspaceId): void;

    /** Синхронно, уже после загрузки нового стора; стор пустого окна на старте события не даёт. */
    readonly onDidOpenWorkspace: Event<WorkspaceId>;

    /** Только синхронный I/O — годится для `process.on("exit")`. */
    flushSync(): void;

    /**
     * Ничего не пишет, только снимает отложенную запись: иначе у недолговечного хранилища
     * (временный каталог теста) она сработает после сноса каталога и пересоздаст его.
     */
    dispose(): void;
}

export type StateScope =
    /** Вне профиля: `User/globalStorage/storage.json` эталона; здесь реестр профилей. */
    | "application"
    /** `<profileDir>/globalState.json`; fallback, когда проект не открыт. */
    | "global"
    /** Per-project: `workspaceStorage/<workspaceId>/state.json`. */
    | "workspace";

/** Одна область без всего сервиса: реестр профилей читает application-стор до резолва каталога профиля. */
export type IStateStore = Pick<IStateService, "get" | "store" | "remove">;

/** Объявляется рядом с контроллером-владельцем, а не с TUIDom-элементом. */
export interface IStateDescriptor<T> {
    readonly key: string;
    readonly scope: StateScope;
    readonly default: T;
    /** Задана вместе с {@link migrate} — стор помнит версию записи и мигрирует устаревшую. */
    readonly version?: number;
    /** `from` — версия записи, 0 — неизвестна. */
    readonly migrate?: (raw: unknown, from: number) => T;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const StateServiceDIToken = token<IStateService>("StateService");
