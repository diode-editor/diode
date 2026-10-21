import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IReferenceRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    /** VS Code просит `true` — в «Find All References» объявление стоит первой строкой. */
    readonly includeDeclaration: boolean;
}

export interface ICoreReference {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly range: IRange;
}

/** upstream `languages.ReferenceProvider`. */
export interface ReferenceProvider {
    provideReferences(request: IReferenceRequest, token: ICancellationToken): Promise<readonly ICoreReference[]>;
}
