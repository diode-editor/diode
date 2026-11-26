import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";

import { EXTENSIONS_VIEWLET_ID, ExtensionsComponentDIToken } from "./extensionsComponent.ts";

/** Upstream `IExtensionsWorkbenchService.openSearch`: shows the marketplace with the query in its search box. */
export function openExtensionsSearch(accessor: ServiceAccessor, query: string): void {
    accessor.get(SidebarServiceDIToken).showViewlet(EXTENSIONS_VIEWLET_ID);
    accessor.get(ExtensionsComponentDIToken).setQuery(query);
}
