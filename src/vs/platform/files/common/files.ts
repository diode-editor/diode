import type { Event } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

// Всё асинхронное: провайдеры расширений живут за границей процесса.
// Устройство — docs/ARCHITECTURE.md, «Файловый сервис».

/** У симлинка — `SymbolicLink` плюс тип цели (флаги, как у vscode). */
export enum FileType {
    Unknown = 0,
    File = 1,
    Directory = 2,
    SymbolicLink = 64,
}

export enum FileSystemProviderCapabilities {
    None = 0,
    Readonly = 1,
    Trash = 2,
    FileAtomicWrite = 4,
    /** Пока без реализации. */
    FileReadStream = 8,
}

export interface IStat {
    readonly type: FileType;
    /** Мс. */
    readonly mtime: number;
    /** Байты. */
    readonly size: number;
}

export interface IFileStat extends IStat {
    readonly resource: Uri;
    readonly name: string;
    readonly etag: string;
    readonly isFile: boolean;
    readonly isDirectory: boolean;
    readonly isSymbolicLink: boolean;
}

export interface IFileStatChild {
    readonly resource: Uri;
    readonly name: string;
    readonly type: FileType;
}

export interface IFileStatWithChildren extends IFileStat {
    /** У файла — пусто. */
    readonly children: readonly IFileStatChild[];
}

export interface IFileContent extends IFileStat {
    readonly value: Uint8Array;
}

export interface IReadFileOptions {
    readonly limit?: number;
}

export interface IWriteFileOptions {
    /** Etag последнего чтения: файл на диске с тех пор изменился — отказ {@link FileOperationResult.ModifiedSince}. */
    readonly etag?: string;
    /** Если провайдер умеет. */
    readonly atomic?: boolean;
}

export interface IProviderWriteOptions {
    readonly atomic: boolean;
}

export interface IDeleteOptions {
    readonly recursive?: boolean;
    readonly useTrash?: boolean;
}

/** У провайдера расширения сейчас только чтение. */
export interface IFileSystemProvider {
    readonly capabilities: FileSystemProviderCapabilities;
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
    readonly target?: Uri;
}

export interface IFileSystemProviderRegistrationEvent {
    readonly scheme: string;
    readonly added: boolean;
}

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

export function isFileOperationError(error: unknown, result: FileOperationResult): error is FileOperationError {
    return error instanceof FileOperationError && error.result === result;
}

/** Форма эталона. */
export function etag(stat: Pick<IStat, "mtime" | "size">): string {
    return `${stat.mtime.toString(29)}${stat.size.toString(31)}`;
}

export interface IFileService {
    /** Занятая схема — ошибка. */
    registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable;
    hasProvider(resource: Uri): boolean;
    hasCapability(resource: Uri, capability: FileSystemProviderCapabilities): boolean;
    /** Провайдер расширения появляется асинхронно, обычно уже после открытия первого файла. */
    readonly onDidChangeFileSystemProviderRegistrations: Event<IFileSystemProviderRegistrationEvent>;

    stat(resource: Uri): Promise<IFileStat>;
    exists(resource: Uri): Promise<boolean>;
    /** Тип цели симлинка у детей уже разрешён. */
    resolve(resource: Uri): Promise<IFileStatWithChildren>;
    readFile(resource: Uri, options?: IReadFileOptions): Promise<IFileContent>;

    writeFile(resource: Uri, value: Uint8Array, options?: IWriteFileOptions): Promise<IFileStat>;
    /** Вместе с недостающими родителями. */
    createFolder(resource: Uri): Promise<void>;
    del(resource: Uri, options?: IDeleteOptions): Promise<void>;
    move(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;
    copy(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;

    /** «Это сделали мы» — без ожидания watcher'а. */
    readonly onDidRunOperation: Event<IFileOperationEvent>;
    /** Изменения снаружи от всех провайдеров. */
    readonly onDidFilesChange: Event<readonly Uri[]>;
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const IFileServiceDIToken = token<IFileService>("FileService");
