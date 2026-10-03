import * as fs from "node:fs";
import * as path from "node:path";

import { curatedConfigInjection } from "../vs/diode/curatedConfigInjection.ts";
import type { IExtensionManifest } from "../vs/platform/extensions/common/iExtensionManifest.ts";
import { toExtensionRegistration } from "../vs/workbench/services/extensions/node/extensionRegistration.ts";
import type { IExtensionRegistration } from "../vs/workbench/services/extensions/node/iExtensionEntry.ts";

/** Тот же префикс, что у пользовательских расширений в ассетах приложения. */
const USER_PREFIX = "UserExtensions/";

/**
 * Регистрация установленного стокового расширения — той же функцией, что у
 * приложения (`toExtensionRegistration`), из УСТАНОВЛЕННОГО манифеста и с теми
 * же курируемыми дефолтами (`curatedConfigInjection`). Так в стоковых сьютах
 * регистрация ровно та, что в проде, а не её копия.
 */
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
            /* v8 ignore start -- установленное расширение пользовательское, исходник встроенного здесь не читается */
            readBuiltinSource: () => Promise.reject(new Error("not a builtin extension")),
            /* v8 ignore stop */
            configInjection: (ext) => curatedConfigInjection(ext.id),
        },
    );
    // Расширение без `main` активировать нечем — падаем с внятным текстом,
    // а не разыменованием undefined в глубине резолва.
    /* v8 ignore start -- у стокового vsix main есть всегда; ветка достижима только на битом манифесте */
    if (registration === null) throw new Error(`${dirName}: в манифесте нет main`);
    /* v8 ignore stop */
    return registration;
}
