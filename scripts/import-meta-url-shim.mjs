// `import.meta.url` for CJS builds (esbuild `inject` + `define`): without the shim esbuild
// makes `import.meta` an empty object, and `createRequire(undefined)` throws.
//
// The value is `require.main.filename`: the binary path in SEA, otherwise `main.cjs`, next to
// which assets and chunks live. Not `__filename`: a chunk does not run as its own file
// (`diode:lazy/<id>.cjs`). Not `process.argv[1]`: in SEA it is the invocation name, and
// run-as-node rewrites it to another script's path.
//
// A getter, not a constant: a module top level constant would be baked into the V8 snapshot.
export const __diode_import_meta = {
    get url() {
        const { pathToFileURL } = process.getBuiltinModule("node:url");
        return pathToFileURL(require.main?.filename ?? process.execPath).href;
    },
};
