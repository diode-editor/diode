import * as path from "node:path";

import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable, toDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { IWorkspaceContextServiceDIToken } from "../../../../platform/workspace/common/iWorkspaceContextServiceDIToken.ts";
import { readUseIgnoreFiles, searchExcludeGlobs } from "../../../common/configuration/excludeSettings.ts";
import type {
    FileSearchResult,
    IFileIndexRequest,
    IFileSearchProvider,
    IFileSearchResults,
    IFileSearchService,
    IFileSearchSession,
    IRawFileMatch,
} from "../common/fileSearch.ts";

const NO_RESULTS: IFileSearchResults = { results: [], limitHit: false };

/** A completed index another session may answer from while its own walk runs. */
interface ICompletedIndex {
    readonly cacheKey: string;
    /** Session order: a walk that ends late must not replace a newer index. */
    readonly order: number;
    /** Folder, excludes and ignore-file flags: an index of other settings is not a stand-in. */
    readonly signature: string;
}

/**
 * Sessions over the provider, like upstream `FileQueryCacheState` + `SearchService.fileSearch`. The
 * editor process keeps no file list (#1179): the index lives where the provider runs. Settings are
 * read when a session opens, so a changed `files.exclude` applies on the next opening.
 */
export class FileSearchService extends Disposable implements IFileSearchService {
    public static dependencies = [IConfigurationServiceDIToken, IWorkspaceContextServiceDIToken] as const;

    private provider: IFileSearchProvider | undefined;
    private readonly providerStore = this.register(new DisposableStore());
    private readonly onDidChangeIndexEmitter = this.register(new Emitter<string>());
    private completed: ICompletedIndex | undefined;
    private nextCacheKey = 1;

    public constructor(
        private readonly configuration: IConfigurationService,
        private readonly workspace: IWorkspaceContextService,
    ) {
        super();
    }

    public registerProvider(provider: IFileSearchProvider): IDisposable {
        this.providerStore.clear();
        this.provider = provider;
        // Keys of the previous provider mean nothing to this one.
        this.completed = undefined;
        this.providerStore.add(
            provider.onDidChangeIndex((cacheKey) => {
                this.onDidChangeIndexEmitter.fire(cacheKey);
            }),
        );
        return toDisposable(() => {
            if (this.provider !== provider) return;
            this.provider = undefined;
            this.completed = undefined;
            this.providerStore.clear();
        });
    }

    public createSession(): IFileSearchSession {
        const folder = this.workspace.getWorkspace().folders.at(0)?.uri.fsPath;
        const provider = this.provider;
        if (folder === undefined || provider === undefined) return new EmptySession();
        const order = this.nextCacheKey++;
        const request: IFileIndexRequest = {
            cacheKey: `file-search-${String(order)}`,
            folder,
            excludes: searchExcludeGlobs(this.configuration),
            useIgnoreFiles: readUseIgnoreFiles(this.configuration),
        };
        return new ProviderSession(this, provider, request, order);
    }

    /** @internal for {@link ProviderSession} */
    public get onDidChangeIndex(): typeof this.onDidChangeIndexEmitter.event {
        return this.onDidChangeIndexEmitter.event;
    }

    /** @internal The stand-in for a session whose walk is still running. */
    public standIn(provider: IFileSearchProvider, signature: string): ICompletedIndex | undefined {
        if (provider !== this.provider) return undefined;
        const completed = this.completed;
        return completed?.signature === signature ? completed : undefined;
    }

    /** @internal Upstream disposes the previous cache once the new one is loaded. */
    public markCompleted(provider: IFileSearchProvider, index: ICompletedIndex): void {
        if (provider !== this.provider) return;
        const previous = this.completed;
        // The late walk's session still answers from it and frees it on dispose.
        if (previous !== undefined && previous.order > index.order) return;
        this.completed = index;
        if (previous !== undefined && previous.cacheKey !== index.cacheKey) provider.clearCache(previous.cacheKey);
    }

    /** @internal */
    public isCompleted(cacheKey: string): boolean {
        return this.completed?.cacheKey === cacheKey;
    }

    /** @internal The provider lost the index (the host restarted). */
    public forget(cacheKey: string): void {
        if (this.completed?.cacheKey === cacheKey) this.completed = undefined;
    }

    public override dispose(): void {
        if (this.completed !== undefined) this.provider?.clearCache(this.completed.cacheKey);
        this.completed = undefined;
        super.dispose();
    }
}

class EmptySession implements IFileSearchSession {
    public readonly onDidChange = (): IDisposable => ({ dispose: () => undefined });
    public readonly ready = Promise.resolve();

    public search(): Promise<IFileSearchResults> {
        return Promise.resolve(NO_RESULTS);
    }

    public dispose(): void {
        // Nothing to release.
    }
}

class ProviderSession extends Disposable implements IFileSearchSession {
    private readonly onDidChangeEmitter = this.register(new Emitter<void>());
    public readonly onDidChange = this.onDidChangeEmitter.event;
    public readonly ready: Promise<void>;
    private readonly signature: string;
    private complete = false;
    private disposed = false;

    public constructor(
        private readonly service: FileSearchService,
        private readonly provider: IFileSearchProvider,
        private readonly request: IFileIndexRequest,
        order: number,
    ) {
        super();
        this.signature = JSON.stringify([request.folder, request.excludes, request.useIgnoreFiles]);
        this.register(
            service.onDidChangeIndex((cacheKey) => {
                // Growth of our own index matters only while nothing completed stands in for it.
                if (cacheKey !== request.cacheKey) return;
                if (this.complete || service.standIn(provider, this.signature) === undefined) {
                    this.onDidChangeEmitter.fire();
                }
            }),
        );
        this.ready = provider.index(request).then(
            () => {
                this.complete = true;
                if (this.disposed) return;
                service.markCompleted(provider, {
                    cacheKey: request.cacheKey,
                    order,
                    signature: this.signature,
                });
                this.onDidChangeEmitter.fire();
            },
            () => undefined,
        );
    }

    /**
     * The index stays only as the stand-in for the next session; an unfinished walk is dropped,
     * the next opening starts a fresh one anyway.
     */
    public override dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (!this.service.isCompleted(this.request.cacheKey)) this.provider.clearCache(this.request.cacheKey);
        super.dispose();
    }

    public async search(query: string, maxResults: number): Promise<IFileSearchResults> {
        const standIn = this.complete ? undefined : this.service.standIn(this.provider, this.signature);
        const cacheKey = standIn?.cacheKey ?? this.request.cacheKey;
        try {
            const result = await this.provider.query({ cacheKey, query, maxResults });
            if (standIn !== undefined && !result.complete) {
                // The stand-in is gone on the provider's side: answer from our own walk.
                this.service.forget(standIn.cacheKey);
                return await this.search(query, maxResults);
            }
            return { results: result.matches.map((m) => toResult(this.request.folder, m)), limitHit: result.limitHit };
        } catch {
            return NO_RESULTS;
        }
    }
}

function toResult(folder: string, match: IRawFileMatch): FileSearchResult {
    return {
        relativePath: match.relativePath,
        absolutePath: path.join(folder, match.relativePath),
        basename: match.relativePath.slice(match.relativePath.lastIndexOf("/") + 1),
        score: match.score,
        matchedIndices: match.matchedIndices,
    };
}
