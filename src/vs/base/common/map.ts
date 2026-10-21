/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/base/common/map.ts

export class SetMap<K, V> {
    private map = new Map<K, Set<V>>();

    public add(key: K, value: V): void {
        let values = this.map.get(key);

        if (!values) {
            values = new Set<V>();
            this.map.set(key, values);
        }

        values.add(value);
    }

    public delete(key: K, value: V): void {
        const values = this.map.get(key);

        if (!values) {
            return;
        }

        values.delete(value);

        if (values.size === 0) {
            this.map.delete(key);
        }
    }

    public forEach(key: K, fn: (value: V) => void): void {
        const values = this.map.get(key);

        if (!values) {
            return;
        }

        values.forEach(fn);
    }

    public get(key: K): ReadonlySet<V> {
        const values = this.map.get(key);
        if (!values) {
            return new Set<V>();
        }
        return values;
    }
}

/** Built on `Map` insertion order rather than `LinkedMap` as upstream, without ratio. */
export class LRUCache<K, V> {
    private readonly map = new Map<K, V>();

    public constructor(private readonly limit: number) {}

    public get size(): number {
        return this.map.size;
    }

    public get(key: K): V | undefined {
        if (!this.map.has(key)) return undefined;
        const value = this.map.get(key) as V;
        this.map.delete(key);
        this.map.set(key, value);
        return value;
    }

    public set(key: K, value: V): this {
        this.map.delete(key);
        this.map.set(key, value);
        for (const oldest of this.map.keys()) {
            if (this.map.size <= this.limit) break;
            this.map.delete(oldest);
        }
        return this;
    }
}
