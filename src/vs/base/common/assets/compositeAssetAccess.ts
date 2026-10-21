import type { IAssetAccess, IAssetEntry } from "./iAssetAccess.ts";

/** The longest prefix wins, `""` is the fallback. */
export class CompositeAssetAccess implements IAssetAccess {
    private readonly routes: readonly (readonly [string, IAssetAccess])[];

    public constructor(routes: Readonly<Record<string, IAssetAccess>>) {
        for (const prefix of Object.keys(routes)) {
            if (prefix.length > 0 && !prefix.endsWith("/")) {
                throw new Error(`CompositeAssetAccess prefix must end with "/" or be empty: ${prefix}`);
            }
        }
        this.routes = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
    }

    public async read(virtualPath: string): Promise<Uint8Array> {
        return this.pick(virtualPath).read(virtualPath);
    }

    public async readText(virtualPath: string): Promise<string> {
        return this.pick(virtualPath).readText(virtualPath);
    }

    public async exists(virtualPath: string): Promise<boolean> {
        const backend = this.tryPick(virtualPath);
        if (backend === undefined) return false;
        return backend.exists(virtualPath);
    }

    public async listEntries(virtualPrefix: string): Promise<IAssetEntry[]> {
        const backend = this.tryPick(virtualPrefix);
        if (backend === undefined) return [];
        return backend.listEntries(virtualPrefix);
    }

    private pick(virtualPath: string): IAssetAccess {
        const backend = this.tryPick(virtualPath);
        if (backend === undefined) {
            throw new Error(`No CompositeAssetAccess route for virtual path: ${virtualPath}`);
        }
        return backend;
    }

    private tryPick(virtualPath: string): IAssetAccess | undefined {
        for (const [prefix, backend] of this.routes) {
            if (prefix === "" || virtualPath === prefix || virtualPath.startsWith(prefix)) {
                return backend;
            }
        }
        return undefined;
    }
}
