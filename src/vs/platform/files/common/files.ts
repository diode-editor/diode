import type { Event } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

/**
 * Контракты файлового сервиса — узкий аналог `platform/files/common/files.ts`
 * vscode: роутер по схеме ресурса, провайдеры схем, stat вместе с содержимым,
 * гард грязной записи по etag, события «это сделали мы» и «изменилось снаружи».
 * Всё асинхронное: провайдеры расширений живут за границей процесса, синхронными
 * они быть не могут. Исследование и план — docs/TODO/FileService.md.
 */

/** Тип ресурса; у симлинка — `SymbolicLink` плюс тип цели (флаги, как у vscode). */
export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

/** Что умеет провайдер схемы (флаги). Из 14 флагов эталона — нужные нам. */
export enum FileSystemProviderCapabilities {
    None = 0,
    /** Только чтение: запись, создание, удаление и перенос отказывают. */
    Readonly = 1,
    /** Удаление умеет класть в корзину. */
    Trash = 2,
    /** Атомарная запись (временный сосед + rename). */
    FileAtomicWrite = 4,
    /** Потоковое чтение — слот под стриминг больших файлов, пока без реализации. */
    FileReadStream = 8,
}

/** Метаданные ресурса от провайдера. */
export interface IStat {
    readonly type: FileType;
    /** Время изменения, мс. */
    readonly mtime: number;
    /** Размер, байты. */
    readonly size: number;
}

/** Метаданные ресурса глазами сервиса: плюс сам ресурс, имя и etag. */
export interface IFileStat extends IStat {
    readonly resource: Uri;
    readonly name: string;
    /** Отпечаток версии на диске (см. {@link etag}). */
    readonly etag: string;
    readonly isFile: boolean;
    readonly isDirectory: boolean;
    readonly isSymbolicLink: boolean;
}

/** Ребёнок каталога в {@link IFileService.resolve}: тип без метаданных. */
export interface IFileStatChild {
    readonly resource: Uri;
    readonly name: string;
    readonly type: FileType;
}

export interface IFileStatWithChildren extends IFileStat {
    /** Дети каталога; у файла — пусто. */
    readonly children: readonly IFileStatChild[];
}

/** Содержимое файла вместе с его метаданными на момент чтения. */
export interface IFileContent extends IFileStat {
    readonly value: Uint8Array;
}

export interface IReadFileOptions {
    /** Потолок размера: файл больше — отказ {@link FileOperationResult.TooLarge}. */
    readonly limit?: number;
}

export interface IWriteFileOptions {
    /**
     * Гард грязной записи: etag последнего чтения. Если файл на диске с тех пор
     * изменился — отказ {@link FileOperationResult.ModifiedSince}.
     */
    readonly etag?: string;
    /** Записать через временного соседа и rename (если провайдер умеет). */
    readonly atomic?: boolean;
}

export interface IProviderWriteOptions {
    readonly atomic: boolean;
}

export interface IDeleteOptions {
    readonly recursive?: boolean;
    readonly useTrash?: boolean;
}

/**
 * Провайдер одной схемы. Обязательны чтение и событие изменений; остальное —
 * по возможностям: у провайдера расширения сейчас только чтение.
 */
export interface IFileSystemProvider {
    readonly capabilities: FileSystemProviderCapabilities;
    /** Ресурсы схемы изменились снаружи. */
    readonly onDidChangeFile: Event<readonly Uri[]>;
    readFile(resource: Uri): Promise<Uint8Array>;
    stat?(resource: Uri): Promise<IStat>;
    readdir?(resource: Uri): Promise<[string, FileType][]>;
    writeFile?(resource: Uri, content: Uint8Array, options: IProviderWriteOptions): Promise<void>;
    mkdir?(resource: Uri): Promise<void>;
    delete?(resource: Uri, options: Required<IDeleteOptions>): Promise<void>;
    rename?(source: Uri, target: Uri, options: { readonly overwrite: boolean }): Promise<void>;
    copy?(source: Uri, target: Uri, options: { readonly overwrite: boolean }): Promise<void>;
}

/** Какая операция прошла через сервис (для {@link IFileService.onDidRunOperation}). */
export enum FileOperation {
    Create,
    Delete,
    Move,
    Copy,
    Write,
}

export interface IFileOperationEvent {
    readonly operation: FileOperation;
    readonly resource: Uri;
    /** Цель переноса/копирования. */
    readonly target?: Uri;
}

export interface IFileSystemProviderRegistrationEvent {
    readonly scheme: string;
    readonly added: boolean;
}

/** Почему операция не удалась — общий словарь для всех провайдеров. */
export enum FileOperationResult {
    NotFound = "NOT_FOUND",
    IsDirectory = "IS_DIRECTORY",
    ModifiedSince = "MODIFIED_SINCE",
    PermissionDenied = "PERMISSION_DENIED",
    Exists = "EXISTS",
    TooLarge = "TOO_LARGE",
    /** Схема без провайдера или операция, которой провайдер не умеет. */
    Unavailable = "UNAVAILABLE",
}

export class FileOperationError extends Error {
    public constructor(
        message: string,
        public readonly result: FileOperationResult,
    ) {
        super(message);
        this.name = "FileOperationError";
    }
}

/** `true`, если `error` — отказ сервиса с этим кодом. */
export function isFileOperationError(error: unknown, result: FileOperationResult): error is FileOperationError {
    return error instanceof FileOperationError && error.result === result;
}

/** Отпечаток версии по форме эталона: время изменения и размер. */
export function etag(stat: Pick<IStat, "mtime" | "size">): string {
    return `${stat.mtime.toString(29)}${stat.size.toString(31)}`;
}

export interface IFileService {
    /** Регистрирует провайдер схемы; занятая схема — ошибка. */
    registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable;
    hasProvider(resource: Uri): boolean;
    hasCapability(resource: Uri, capability: FileSystemProviderCapabilities): boolean;
    /**
     * Набор провайдеров изменился. Провайдер расширения появляется асинхронно,
     * обычно уже после открытия первого файла, — без события потребитель
     * остался бы с прежним «провайдера нет».
     */
    readonly onDidChangeFileSystemProviderRegistrations: Event<IFileSystemProviderRegistrationEvent>;

    stat(resource: Uri): Promise<IFileStat>;
    exists(resource: Uri): Promise<boolean>;
    /** Stat каталога вместе с детьми (тип цели симлинка уже разрешён). */
    resolve(resource: Uri): Promise<IFileStatWithChildren>;
    readFile(resource: Uri, options?: IReadFileOptions): Promise<IFileContent>;

    writeFile(resource: Uri, value: Uint8Array, options?: IWriteFileOptions): Promise<IFileStat>;
    /** Создаёт каталог вместе с недостающими родителями. */
    createFolder(resource: Uri): Promise<void>;
    del(resource: Uri, options?: IDeleteOptions): Promise<void>;
    move(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;
    copy(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;

    /** Операция прошла через сервис — «это сделали мы», без ожидания watcher'а. */
    readonly onDidRunOperation: Event<IFileOperationEvent>;
    /** Ресурсы изменились снаружи — агрегат событий всех провайдеров. */
    readonly onDidFilesChange: Event<readonly Uri[]>;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IFileServiceDIToken = token<IFileService>("FileService");
