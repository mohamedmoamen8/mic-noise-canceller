declare module '@jitsi/rnnoise-wasm/dist/rnnoise-sync' {
  // The Emscripten-generated sync module export: a zero-arg factory that
  // synchronously instantiates the WASM binary (inlined as base64) and
  // returns the Module object with the C API bound as `_`-prefixed methods.
  const createRNNWasmModuleSync: () => unknown;
  export default createRNNWasmModuleSync;
}
