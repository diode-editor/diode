import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IReferenceRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** The provider reads the text from its own synced copy of this version. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
    /** VS Code asks for `true`: "Find All References" lists the declaration first. */
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
