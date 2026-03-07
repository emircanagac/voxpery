// Emscripten checks `typeof window == "object"` and `typeof WorkerGlobalScope !== "undefined"`
// Since AudioWorkletGlobalScope has neither, we must spoof these exactly so
// Emscripten doesn't throw "not compiled for this environment" on load.

if (typeof globalThis !== 'undefined') {
  // @ts-ignore
  globalThis.window = globalThis
  // @ts-ignore
  globalThis.WorkerGlobalScope = globalThis
}
