// Upstream `getDefaultProfile`, trimmed down to the path. A seam in common: only the node layer knows the shell, but
// tasks need its name before the terminal exists — it picks the quoting and `-c`.

import { token } from "../../../../platform/instantiation/common/diContainer.ts";

/** Shell path the terminal would launch with when no `shellPath` is given. */
export type DefaultShellResolver = () => string;

export const DefaultShellResolverDIToken = token<DefaultShellResolver>("DefaultShellResolver");
