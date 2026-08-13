import * as fs from "node:fs";

import type { IDisposable } from "@tuidom/all/common/disposable";
import type { Uri } from "../../../base/common/uri.ts";
import type { IReadOnlyFileSystemProvider } from "../common/iFileSystemProviderRegistry.ts";

/**
 * Read-only поставщик схемы `file:` — доступ к диску для browser-слоя через
 * реестр (первый потребитель — прямой дифф из Changes: modified-сторона файла,
 * не открытого в редакторе). Горячий путь открытия файла (`TextFileModel`)
 * по-прежнему читает диск напрямую, минуя реестр.
 */
export class DiskFileSystemProvider implements IReadOnlyFileSystemProvider {
    public readFile(uri: Uri): Promise<Uint8Array> {
        return fs.promises.readFile(uri.fsPath);
    }

    /**
     * Вотчинга нет намеренно: потребители `file:` через реестр читают по
     * требованию (снимок для диффа), а слежение за живыми буферами — зона
     * `TextFileModel`/`FileWatcher`.
     */
    public onDidChangeFile(): IDisposable {
        return { dispose: () => undefined };
    }
}
