import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IDefinitionRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
}

/** `range` у LocationLink — `targetSelectionRange ?? targetRange`. */
export interface ICoreDefinitionLocation {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly range: IRange;
}

/** upstream `languages.DefinitionProvider`. */
export interface DefinitionProvider {
    provideDefinition(
        request: IDefinitionRequest,
        token: ICancellationToken,
    ): Promise<readonly ICoreDefinitionLocation[]>;
}
