import {BrowserToolchain} from './toolchain.mjs';
import {buildInstaller} from './installer.mjs';

let active = false;
let engine;
self.onmessage = async ({data}) => {
    if (data.type !== 'compile' || active) return;
    active = true;
    const emit = event => self.postMessage({...event, id: data.id});
    try {
        if (!engine) engine = new BrowserToolchain(data.manifestUrl || './toolchain/manifest.json', emit);
        engine.emit = emit;
        let result = await engine.compile(data.request);
        if (data.request.installer) result = await buildInstaller(engine, data.request, result);
        self.postMessage({type: 'result', id: data.id, result}, result.artifacts.map(artifact => artifact.bytes.buffer));
    } catch (error) {
        emit({type: 'error', text: error.message, exitCode: error.exitCode || 1});
    } finally {
        active = false;
    }
};
