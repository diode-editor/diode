import * as fs from "node:fs";
import * as path from "node:path";

import { validateVirtualPath } from "../../common/assets/assetBundleFormat.ts";
import type { IAssetAccess, IAssetEntry } from "../../common/assets/iAssetAccess.ts";

/** A directory prefix ends with `/`; without `/` it is the full path of a single file. */
export type AssetMapping = Readonly<Record<string, string>>;

export class FsAssetAccess implements IAssetAccess {
    private readonly mapping: readonly (readonly [string, string])[];

    public constructor(mapping: AssetMapping) {
        // Longest prefixes first, otherwise `""` swallows everything.
        this.mapping = Object.entries(mapping).sort((a, b) => b[0].length - a[0].length);
    }

    public async read(virtualPath: string): Promise<Uint8Array> {
        validateVirtualPath(virtualPath);
        const fsPath = this.resolveToFs(virtualPath);
        return fs.promises.readFile(fsPath);
    }

    public async readText(virtualPath: string): Promise<string> {
        validateVirtualPath(virtualPath);
        const fsPath = this.resolveToFs(virtualPath);
        return fs.promises.readFile(fsPath, "utf-8");
    }

    public async exists(virtualPath: string): Promise<boolean> {
        validateVirtualPath(virtualPath);
        try {
            const fsPath = this.resolveToFs(virtualPath);
            await fs.promises.access(fsPath);
            return true;
        } catch {
            return false;
        }
    }

    public async listEntries(virtualPrefix: string): Promise<IAssetEntry[]> {
        if (virtualPrefix.length > 0 && !virtualPrefix.endsWith("/")) {
            throw new Error(`listEntries prefix must end with "/" or be empty: ${virtualPrefix}`);
        }
        const fsDir = this.resolveDirToFs(virtualPrefix);
        let dirents: fs.Dirent[];
        try {
            dirents = await fs.promises.readdir(fsDir, { withFileTypes: true });
        } catch {
            return [];
        }
        return dirents.map((d) => ({ name: d.name, isDirectory: d.isDirectory() }));
    }

    private resolveToFs(virtualPath: string): string {
        for (const [prefix, root] of this.mapping) {
            if (prefix.endsWith("/")) {
                if (virtualPath.startsWith(prefix)) {
                    const tail = virtualPath.slice(prefix.length);
                    return path.join(root, tail);
                }
            } else if (virtualPath === prefix) {
                return root;
            }
        }
        throw new Error(`No FS mapping for virtual path: ${virtualPath}`);
    }

    private resolveDirToFs(virtualPrefix: string): string {
        if (virtualPrefix === "") {
            for (const [prefix, root] of this.mapping) {
                if (prefix === "") return root;
            }
            throw new Error('No FS mapping for empty virtual prefix ("").');
        }
        for (const [prefix, root] of this.mapping) {
            if (!prefix.endsWith("/")) continue;
            if (virtualPrefix === prefix) return root;
            if (virtualPrefix.startsWith(prefix)) {
                const tail = virtualPrefix.slice(prefix.length, -1); // strip trailing "/"
                return path.join(root, tail);
            }
        }
        throw new Error(`No FS mapping for virtual prefix: ${virtualPrefix}`);
    }
}
