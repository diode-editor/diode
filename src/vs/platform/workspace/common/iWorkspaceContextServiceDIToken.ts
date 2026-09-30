import { token } from "../../instantiation/common/diContainer.ts";

import type { IWorkspaceContextService } from "./iWorkspaceContextService.ts";

export const IWorkspaceContextServiceDIToken = token<IWorkspaceContextService>("WorkspaceContextService");
