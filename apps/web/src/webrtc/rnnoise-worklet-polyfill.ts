// Emscripten checks `typeof window == "object"` and `typeof WorkerGlobalScope !== "undefined"`
// Since AudioWorkletGlobalScope has neither, we must spoof these exactly so
// Emscripten doesn't throw "not compiled for this environment" on load.

if (typeof globalThis !== 'undefined') {
  // @ts-expect-error Spoof window for Emscripten
  globalThis.window = globalThis
  // @ts-expect-error Spoof WorkerGlobalScope for Emscripten
  globalThis.WorkerGlobalScope = globalThis
}
