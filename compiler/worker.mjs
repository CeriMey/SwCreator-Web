import {BrowserToolchain} from './toolchain.mjs';

let active = false;
let engine;
self.onmessage = async ({data}) => {
    if (data.type !== 'compile' || active) return;
    active = true;
    const emit = event => self.postMessage({...event, id: data.id});
    try {
        if (!engine) engine = new BrowserToolchain(data.manifestUrl || './toolchain/manifest.json', emit);
        engine.emit = emit;
        const result = await engine.compile(data.request);
        self.postMessage({type: 'result', id: data.id, result}, result.artifacts.map(artifact => artifact.bytes.buffer));
    } catch (error) {
        emit({type: 'error', text: error.message, exitCode: error.exitCode || 1});
    } finally {
        active = false;
    }
};
