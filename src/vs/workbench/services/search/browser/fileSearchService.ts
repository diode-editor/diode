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

/** Nothing answers, and nothing will: a failed provider, no folder or no provider. */
const NO_RESULTS: IFileSearchResults = { results: [], limitHit: false, complete: true };

/** The last index whose walk ended: sessions of the same settings answer from it. */
interface ICompletedIndex {
    readonly provider: IFileSearchProvider;
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
    /** @internal for {@link ProviderSession} */
    public readonly onDidChangeIndex = this.onDidChangeIndexEmitter.event;
    private completed: ICompletedIndex | undefined;
    private nextOrder = 1;

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
        const order = this.nextOrder++;
        const request: IFileIndexRequest = {
            cacheKey: `file-search-${String(order)}`,
            folder,
            excludes: searchExcludeGlobs(this.configuration),
            useIgnoreFiles: readUseIgnoreFiles(this.configuration),
        };
        return new ProviderSession(this, provider, request, order);
    }

    /** @internal The key a session of these settings answers from, if any walk of them ended. */
    public completedKey(signature: string): string | undefined {
        return this.completed?.signature === signature ? this.completed.cacheKey : undefined;
    }

    /** @internal Upstream disposes the previous cache once the new one is loaded. */
    public markCompleted(index: ICompletedIndex): void {
        if (index.provider !== this.provider) return;
        const previous = this.completed;
        if (previous !== undefined) {
            // The late walk's session still answers from its own index and frees it on dispose.
            // Stryker disable next-line EqualityOperator: orders are unique, `>=` and `>` never differ
            if (previous.order > index.order) return;
            previous.provider.clearCache(previous.cacheKey);
        }
        this.completed = index;
    }

    /** @internal */
    public isCompleted(cacheKey: string): boolean {
        return this.completed?.cacheKey === cacheKey;
    }

    public override dispose(): void {
        this.completed?.provider.clearCache(this.completed.cacheKey);
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
    private disposed = false;

    public constructor(
        private readonly service: FileSearchService,
        private readonly provider: IFileSearchProvider,
        private readonly request: IFileIndexRequest,
        order: number,
    ) {
        super();
        const signature = JSON.stringify([request.folder, request.excludes, request.useIgnoreFiles]);
        this.signature = signature;
        this.register(
            service.onDidChangeIndex((cacheKey) => {
                // Growth is news only for the index that answers; a completed stand-in does not grow.
                if (this.answeringKey() === cacheKey) this.onDidChangeEmitter.fire();
            }),
        );
        this.ready = provider.index(request).then(
            () => {
                if (this.disposed) return;
                service.markCompleted({ provider, cacheKey: request.cacheKey, order, signature });
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
        const own = this.request.cacheKey;
        const cacheKey = this.answeringKey();
        try {
            let result = await this.provider.query({ cacheKey, query, maxResults });
            // The stand-in is gone on the provider's side (the host restarted): answer from our own walk.
            if (cacheKey !== own && !result.complete)
                result = await this.provider.query({ cacheKey: own, query, maxResults });
            return {
                results: result.matches.map((m) => toResult(this.request.folder, m)),
                limitHit: result.limitHit,
                complete: result.complete,
            };
        } catch {
            return NO_RESULTS;
        }
    }

    /** The last completed index of our settings — our own once our walk ended — else our growing one. */
    private answeringKey(): string {
        return this.service.completedKey(this.signature) ?? this.request.cacheKey;
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
