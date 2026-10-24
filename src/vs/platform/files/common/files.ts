import type { Event } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { Uri } from "../../../base/common/uri.ts";
import { token } from "../../instantiation/common/diContainer.ts";

// Everything is async: extension providers live across a process boundary.
// Design: docs/ARCHITECTURE.md, the file service section.

/** A symlink is `SymbolicLink` plus the target type (flags, as in vscode). */
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
    /** Not implemented yet. */
    FileReadStream = 8,
}

export interface IStat {
    readonly type: FileType;
    /** Milliseconds. */
    readonly mtime: number;
    /** Bytes. */
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
    /** Empty for a file. */
    readonly children: readonly IFileStatChild[];
}

/**
 * What a write takes: the bytes at once, or a stream of pieces written one by one, so that saving a large file
 * never holds all of its bytes (upstream `VSBuffer | VSBufferReadableStream`). A stream is consumed once.
 */
export type FileWriteContent = Uint8Array | AsyncIterable<Uint8Array>;

/** For a provider that writes bytes at once (memory, an extension's provider across the RPC): a stream is joined. */
export async function joinFileWriteContent(content: FileWriteContent): Promise<Uint8Array> {
    if (content instanceof Uint8Array) return content;
    const parts: Uint8Array[] = [];
    for await (const part of content) parts.push(part);
    return Buffer.concat(parts);
}

export interface IFileContent extends IFileStat {
    readonly value: Uint8Array;
}

export interface IReadFileOptions {
    readonly limit?: number;
}

export interface IWriteFileOptions {
    /** Etag of the last read: if the file on disk changed since, fails with {@link FileOperationResult.ModifiedSince}. */
    readonly etag?: string;
    /** If the provider supports it. */
    readonly atomic?: boolean;
}

export interface IProviderWriteOptions {
    readonly atomic: boolean;
}

export interface IDeleteOptions {
    readonly recursive?: boolean;
    readonly useTrash?: boolean;
}

/** Extension providers are read-only for now. */
export interface IFileSystemProvider {
    readonly capabilities: FileSystemProviderCapabilities;
    readonly onDidChangeFile: Event<readonly Uri[]>;
    readFile(resource: Uri): Promise<Uint8Array>;
    stat?(resource: Uri): Promise<IStat>;
    readdir?(resource: Uri): Promise<[string, FileType][]>;
    writeFile?(resource: Uri, content: FileWriteContent, options: IProviderWriteOptions): Promise<void>;
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
    /** A scheme without a provider, or an operation the provider doesn't support. */
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

/** Same format as upstream. */
export function etag(stat: Pick<IStat, "mtime" | "size">): string {
    return `${stat.mtime.toString(29)}${stat.size.toString(31)}`;
}

export interface IFileService {
    /** Throws if the scheme is already taken. */
    registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable;
    hasProvider(resource: Uri): boolean;
    hasCapability(resource: Uri, capability: FileSystemProviderCapabilities): boolean;
    /** An extension provider appears asynchronously, usually after the first file is already open. */
    readonly onDidChangeFileSystemProviderRegistrations: Event<IFileSystemProviderRegistrationEvent>;

    stat(resource: Uri): Promise<IFileStat>;
    exists(resource: Uri): Promise<boolean>;
    /** Children's symlink target types are already resolved. */
    resolve(resource: Uri): Promise<IFileStatWithChildren>;
    readFile(resource: Uri, options?: IReadFileOptions): Promise<IFileContent>;

    writeFile(resource: Uri, value: FileWriteContent, options?: IWriteFileOptions): Promise<IFileStat>;
    /** Creates missing parents too. */
    createFolder(resource: Uri): Promise<void>;
    del(resource: Uri, options?: IDeleteOptions): Promise<void>;
    move(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;
    copy(source: Uri, target: Uri, overwrite?: boolean): Promise<void>;

    /** "We did this", without waiting for the watcher. */
    readonly onDidRunOperation: Event<IFileOperationEvent>;
    /** External changes from all providers. */
    readonly onDidFilesChange: Event<readonly Uri[]>;
}

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is just a debug label
export const IFileServiceDIToken = token<IFileService>("FileService");
