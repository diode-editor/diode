import * as fs from "node:fs";
import * as path from "node:path";

import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import { toExtensionRegistration } from "../vs/workbench/services/extensions/node/extensionRegistration.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

/** Same prefix as user extensions in the app's assets. */
const USER_PREFIX = "UserExtensions/";

/** Uses the app's own function, so the registration is exactly the production one, not a copy. */
export async function registrationFromInstalled(
    extensionsDir: string,
    id: string,
    version: string,
): Promise<IExtensionRegistration> {
    const dirName = `${id}-${version}`;
    const manifest = JSON.parse(
        fs.readFileSync(path.join(extensionsDir, dirName, "package.json"), "utf8"),
    ) as IExtensionManifest;
    const registration = await toExtensionRegistration(
        { id, manifest, location: `${USER_PREFIX}${dirName}/`, isBuiltin: false },
        {
            userPrefix: USER_PREFIX,
            userExtensionsDir: extensionsDir,
            /* v8 ignore start -- an installed extension is a user one; builtin sources are never read here */
            readBuiltinSource: () => Promise.reject(new Error("not a builtin extension")),
            /* v8 ignore stop */
        },
    );
    /* v8 ignore start -- a stock vsix always has main; the branch is reachable only with a broken manifest */
    if (registration === null) throw new Error(`${dirName}: в манифесте нет main`);
    /* v8 ignore stop */
    return registration;
}
