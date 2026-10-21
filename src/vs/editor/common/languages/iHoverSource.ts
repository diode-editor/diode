import type { ICancellationToken } from "../../../base/common/cancellation.ts";
import type { IRange } from "../core/iRange.ts";

export interface IHoverRequest {
    /** `uri.toString()`. */
    readonly uri: string;
    readonly languageId: string;
    /** Текст провайдер берёт из своей синхронизированной копии этой версии. */
    readonly versionId: number;
    /** 0-based. */
    readonly line: number;
    readonly character: number;
}

/** `contents` — сырой markdown: стрип разметки — забота UI, протокол её не трогает. */
export interface ICoreHover {
    readonly contents: readonly string[];
    /** Нет — UI считает позицией запроса. */
    readonly range?: IRange;
}

/** upstream `languages.HoverProvider`. */
export interface HoverProvider {
    provideHover(request: IHoverRequest, token: ICancellationToken): Promise<ICoreHover | undefined>;
}
