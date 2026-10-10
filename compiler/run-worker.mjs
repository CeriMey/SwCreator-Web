self.onmessage = async ({data}) => {
    try {
        const {WASI, PreopenDirectory, OpenFile, File, ConsoleStdout} = await import(data.wasiShim);
        const decoders = [new TextDecoder(), new TextDecoder()];
        const write = index => bytes => self.postMessage({type: 'output', text: decoders[index].decode(bytes, {stream: true})});
        const wasi = new WASI([data.name || 'application'], [], [
            new OpenFile(new File(new Uint8Array())), new ConsoleStdout(write(0)), new ConsoleStdout(write(1)),
            new PreopenDirectory('/', new Map()),
        ]);
        const instance = await WebAssembly.instantiate(await WebAssembly.compile(data.wasm), {wasi_snapshot_preview1: wasi.wasiImport});
        const exitCode = wasi.start(instance);
        for (const decoder of decoders) {
            const text = decoder.decode();
            if (text) self.postMessage({type: 'output', text});
        }
        self.postMessage({type: 'exit', exitCode});
    } catch (error) { self.postMessage({type: 'error', text: error.message}); }
};
