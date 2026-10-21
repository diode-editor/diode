import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../../../platform/instantiation/common/diContainer.ts";

import type { IQuickAccessProvider } from "./iQuickAccessProvider.ts";

/** Токен резолвится лениво: тяжёлые зависимости провайдера не поднимаются раньше времени. */
export interface IQuickAccessProviderDescriptor {
    /** `""` — дефолтный провайдер. */
    readonly prefix: string;
    readonly provider: Token<IQuickAccessProvider>;
}

export interface ResolvedQuickAccessProvider {
    readonly prefix: string;
    readonly provider: IQuickAccessProvider;
}

export const QuickAccessProvidersDIToken = token<readonly IQuickAccessProviderDescriptor[]>("QuickAccessProviders");
export const QuickAccessRegistryDIToken = token<QuickAccessRegistry>("QuickAccessRegistry");

/** Аналог `IQuickAccessRegistry` vscode: выбирает провайдера с самым длинным подходящим префиксом. */
export class QuickAccessRegistry {
    public static dependencies = [ServiceAccessorDIToken, QuickAccessProvidersDIToken] as const;

    public constructor(
        private readonly accessor: ServiceAccessor,
        private readonly descriptors: readonly IQuickAccessProviderDescriptor[],
    ) {}

    public getProvider(query: string): ResolvedQuickAccessProvider {
        let best: IQuickAccessProviderDescriptor | null = null;
        for (const descriptor of this.descriptors) {
            if (!query.startsWith(descriptor.prefix)) continue;
            if (best === null || descriptor.prefix.length > best.prefix.length) {
                best = descriptor;
            }
        }
        if (best === null) {
            throw new Error(
                'No quick-access provider matched the query (a default provider with prefix "" is required)',
            );
        }
        return { prefix: best.prefix, provider: this.accessor.get(best.provider) };
    }
}
