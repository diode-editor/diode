import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { ServiceAccessorDIToken } from "../../../../platform/instantiation/common/diContainer.ts";

import type { IQuickAccessProvider } from "./iQuickAccessProvider.ts";

/**
 * Декларативная регистрация quick-access-провайдера: префикс запроса плюс
 * DI-токен провайдера (резолвится лениво при первом обращении — тяжёлые
 * зависимости провайдера не поднимаются раньше времени).
 */
export interface IQuickAccessProviderDescriptor {
    /** Префикс, включающий провайдера (`">"` — команды); `""` — дефолтный. */
    readonly prefix: string;
    readonly provider: Token<IQuickAccessProvider>;
}

/** Активный провайдер, отрезолвленный реестром по запросу. */
export interface ResolvedQuickAccessProvider {
    readonly prefix: string;
    readonly provider: IQuickAccessProvider;
}

export const QuickAccessProvidersDIToken = token<readonly IQuickAccessProviderDescriptor[]>("QuickAccessProviders");
export const QuickAccessRegistryDIToken = token<QuickAccessRegistry>("QuickAccessRegistry");

/**
 * Реестр quick-access-провайдеров (аналог `IQuickAccessRegistry` vscode,
 * `vs/platform/quickinput/common/quickAccess.ts`): по запросу выбирает
 * провайдера с самым длинным подходящим префиксом; провайдер с пустым
 * префиксом — дефолтный. Список — явный массив `QUICK_ACCESS_PROVIDERS`
 * (наша конвенция вместо саморегистрации через import-side-effects).
 */
export class QuickAccessRegistry {
    public static dependencies = [ServiceAccessorDIToken, QuickAccessProvidersDIToken] as const;

    public constructor(
        private readonly accessor: ServiceAccessor,
        private readonly descriptors: readonly IQuickAccessProviderDescriptor[],
    ) {}

    /** Провайдер для запроса: самый длинный префикс, с которого запрос начинается. */
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
