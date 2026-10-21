import type { IQuickAccessProviderDescriptor } from "../common/quickAccessRegistry.ts";

import { CommandsQuickAccessProvider, CommandsQuickAccessProviderDIToken } from "./commandsQuickAccessProvider.ts";
import { FilesQuickAccessProvider, FilesQuickAccessProviderDIToken } from "./filesQuickAccessProvider.ts";
import { GotoLineQuickAccessProvider, GotoLineQuickAccessProviderDIToken } from "./gotoLineQuickAccessProvider.ts";
import {
    OpenEditorsQuickAccessProvider,
    OpenEditorsQuickAccessProviderDIToken,
} from "./openEditorsQuickAccessProvider.ts";

/** Entry order doesn't matter: the registry picks by the longest matching prefix. */
export const QUICK_ACCESS_PROVIDERS: readonly IQuickAccessProviderDescriptor[] = [
    { prefix: FilesQuickAccessProvider.PREFIX, provider: FilesQuickAccessProviderDIToken },
    { prefix: CommandsQuickAccessProvider.PREFIX, provider: CommandsQuickAccessProviderDIToken },
    { prefix: GotoLineQuickAccessProvider.PREFIX, provider: GotoLineQuickAccessProviderDIToken },
    { prefix: OpenEditorsQuickAccessProvider.PREFIX, provider: OpenEditorsQuickAccessProviderDIToken },
];
