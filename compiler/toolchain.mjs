// The compiler, linker and filesystem in this module run inside a browser worker.
// Fetches load static SDK assets; project sources are never sent to a build server.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function cachedLoad(cache, key, load) {
    if (!cache.has(key)) {
        const pending = Promise.resolve().then(load).catch(error => {
            if (cache.get(key) === pending) cache.delete(key);
            throw error;
        });
        cache.set(key, pending);
    }
    return cache.get(key);
}

export function projectPath(value) {
    if (typeof value !== 'string' || !value || value.includes('\0') || value.includes('\\')) {
        throw new Error('Invalid project file path.');
    }
    const parts = value.split('/');
    if (value.startsWith('/') || parts.some(part => !part || part === '.' || part === '..')) {
        throw new Error(`Invalid project file path: ${value}`);
    }
    return parts.join('/');
}

// Recent Clang emits GNU DLL-export exclusions that the packaged older PE
// linker rejects. Static executable links do not need those exclusions. Blank
// only that directive, preserving the COFF section and relocation offsets.
export function stripUnsupportedCoffExclusions(input) {
    const bytes = new Uint8Array(input);
    if (bytes.length < 20) return bytes;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const machine = view.getUint16(0, true);
    let count = view.getUint16(2, true);
    let sections;
    if (machine === 0x8664) sections = 20 + view.getUint16(16, true);
    else if (machine === 0 && count === 0xffff && bytes.length >= 56) {
        const bigobjId = [0xc7,0xa1,0xba,0xd1,0xee,0xba,0xa9,0x4b,0xaf,0x20,0xfa,0xf6,0x6a,0xa4,0xdc,0xb8];
        if (view.getUint16(4, true) < 2 || view.getUint16(6, true) !== 0x8664
            || !bigobjId.every((byte, index) => bytes[12 + index] === byte)) return bytes;
        count = view.getUint32(44, true);
        sections = 56;
    } else return bytes;
    if (sections + count * 40 > bytes.length) throw new Error('Malformed COFF section table.');
    const latin1 = new TextDecoder('latin1');
    for (let index = 0; index < count; ++index) {
        const section = sections + index * 40;
        if (latin1.decode(bytes.subarray(section, section + 8)) !== '.drectve') continue;
        const size = view.getUint32(section + 16, true);
        const pointer = view.getUint32(section + 20, true);
        if (pointer + size > bytes.length) throw new Error('Malformed COFF directive section.');
        // Latin-1 decoding keeps one JS character per byte, including unrelated
        // UTF-8 symbol names, so match offsets remain exact byte offsets.
        const payload = latin1.decode(bytes.subarray(pointer, pointer + size));
        const exclusions = /(?:^|[\s\0])("-exclude-symbols:[^"\0]*"|-exclude-symbols:[^\s\0"]+)/g;
        for (const match of payload.matchAll(exclusions)) {
            const directive = match[1];
            const start = pointer + match.index + match[0].length - directive.length;
            bytes.fill(32, start, start + directive.length);
        }
    }
    return bytes;
}

export async function verifiedBytes(url, sha256) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Unable to load ${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256) {
        const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
        const actual = Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
        if (actual !== sha256.toLowerCase()) throw new Error(`SDK checksum mismatch: ${url}`);
    }
    return bytes;
}

function tarString(bytes) {
    const nul = bytes.indexOf(0);
    return decoder.decode(nul < 0 ? bytes : bytes.subarray(0, nul));
}

export async function unpackArchive(bytes, compressed = true) {
    if (compressed) {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    const files = new Map();
    for (let offset = 0; offset + 512 <= bytes.length;) {
        const header = bytes.subarray(offset, offset + 512);
        if (header.every(byte => byte === 0)) break;
        const name = tarString(header.subarray(0, 100));
        const prefix = tarString(header.subarray(345, 500));
        const path = (prefix ? `${prefix}/${name}` : name).replace(/^\.\//, '').replace(/\/$/, '');
        const sizeText = tarString(header.subarray(124, 136)).trim();
        const size = parseInt(sizeText || '0', 8);
        if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > bytes.length) {
            throw new Error('Corrupt SDK archive.');
        }
        const type = header[156];
        if (type === 0 || type === 48) {
            projectPath(path);
            files.set(path, bytes.subarray(offset + 512, offset + 512 + size));
        } else if (type !== 53) {
            throw new Error(`Unsupported SDK archive entry: ${path}`);
        }
        offset += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
}

export class BrowserToolchain {
    constructor(manifestUrl, emit = () => {}) {
        this.manifestUrl = new URL(manifestUrl, import.meta.url);
        this.emit = emit;
        this.modules = new Map();
        this.archives = new Map();
        this.nativeCompilers = new Map();
        this.sdkManifests = new Map();
    }

    async initialize() {
        if (this.manifest) return;
        this.emit({type: 'status', text: 'Loading the browser compiler…'});
        const response = await fetch(this.manifestUrl);
        if (!response.ok) throw new Error('Browser toolchain is missing. Run tools/web-toolchain/prepare.py for this build.');
        const manifest = await response.json();
        if (manifest.schemaVersion !== 1) throw new Error('Unsupported browser toolchain manifest.');
        const shim = await import(new URL(manifest.wasiShim, this.manifestUrl).href);
        this.manifest = manifest;
        this.shim = shim;
    }

    async module(asset) {
        const url = new URL(asset.path, this.manifestUrl).href;
        return cachedLoad(this.modules, url,
            () => verifiedBytes(url, asset.sha256).then(bytes => WebAssembly.compile(bytes)));
    }

    async archive(asset, base = this.manifestUrl) {
        const url = new URL(asset.path, base).href;
        return cachedLoad(this.archives, url,
            () => verifiedBytes(url, asset.sha256).then(bytes => unpackArchive(bytes, url.endsWith('.gz'))));
    }

    sdkManifest(url, missingMessage) {
        return cachedLoad(this.sdkManifests, url.href, async () => {
            const response = await fetch(url);
            if (!response.ok) throw new Error(missingMessage);
            return response.json();
        });
    }

    put(root, path, bytes, readonly = false) {
        const {Directory, File} = this.shim;
        const parts = projectPath(path.replace(/^\//, '')).split('/');
        const name = parts.pop();
        let directory = root;
        for (const part of parts) {
            if (!directory.contents.has(part)) directory.contents.set(part, new Directory(new Map()));
            directory = directory.contents.get(part);
            if (!(directory instanceof Directory)) throw new Error(`File blocks directory: ${path}`);
        }
        const file = new File(bytes, {readonly});
        // Headers and archives are immutable and can share the downloaded storage.
        if (readonly) file.data = bytes;
        directory.contents.set(name, file);
    }

    get(root, path) {
        let entry = root;
        for (const part of path.replace(/^\//, '').split('/')) entry = entry?.contents?.get(part);
        if (!entry?.data) throw new Error(`Compiler did not produce ${path}`);
        return new Uint8Array(entry.data);
    }

    async runTool(asset, argv, root, output) {
        const {WASI, PreopenDirectory, OpenFile, File, ConsoleStdout} = this.shim;
        const stdout = new TextDecoder();
        const stderr = new TextDecoder();
        const write = (stream, text) => {
            if (!text) return;
            output.push(text);
            this.emit({type: 'output', stream, text});
        };
        const wasi = new WASI(argv, [], [
            new OpenFile(new File(new Uint8Array())),
            new ConsoleStdout(bytes => write('stdout', stdout.decode(bytes, {stream: true}))),
            new ConsoleStdout(bytes => write('stderr', stderr.decode(bytes, {stream: true}))),
            new PreopenDirectory('/', root.contents),
        ]);
        const instance = await WebAssembly.instantiate(await this.module(asset), {wasi_snapshot_preview1: wasi.wasiImport});
        const code = wasi.start(instance);
        write('stdout', stdout.decode());
        write('stderr', stderr.decode());
        if (code !== 0) {
            const error = new Error(`${argv[0]} failed with exit code ${code}.`);
            error.exitCode = code;
            throw error;
        }
    }

    async compile(request) {
        await this.initialize();
        const sideModule = request.target === 'web' && (request.profile === 'swstack' || request.profile === 'core');
        const targetName = sideModule ? 'swstack' : request.target;
        let target = this.manifest.targets[targetName];
        let sdkBase = this.manifestUrl;
        if (targetName === 'swstack') {
            sdkBase = new URL('../../runtime/sdk-manifest.json', this.manifestUrl);
            const sdk = await this.sdkManifest(sdkBase,
                'The SwStack browser SDK is missing. Package the preview runtime first.');
            target = {...target, ...sdk, kind: 'emscripten-side', triple: 'wasm32-unknown-emscripten'};
            if (request.profile === 'core') {
                // Core projects share the SDK and event scheduler, with their
                // own entry point and no widget window.
                target.linkArguments = (target.linkArguments || []).map(argument =>
                    argument === '--export=creator_create_ui' ? '--export=creator_create_core' : argument);
            }
        }
        if (target?.sdkManifest) {
            sdkBase = new URL(target.sdkManifest, this.manifestUrl);
            const sdk = await this.sdkManifest(sdkBase,
                `The ${request.target} target SDK is missing. Package it before compiling this project.`);
            target = {...target, ...sdk};
        }
        if (target?.profiles) {
            const profile = target.profiles[request.profile || 'console'];
            if (!profile) throw new Error(`The ${request.target} SDK does not provide the ${request.profile} profile.`);
            target = {...target, ...profile};
        }
        if (!target) throw new Error(`This browser toolchain does not provide the ${request.target} target.`);
        const root = new this.shim.Directory(new Map());
        for (const asset of target.archives || []) {
            for (const [path, bytes] of await this.archive(asset, sdkBase)) this.put(root, path, bytes, true);
        }
        this.put(root, 'project/.keep', new Uint8Array());
        this.put(root, 'build/.keep', new Uint8Array());
        const files = request.files || [];
        const paths = new Set();
        for (const file of files) {
            const path = projectPath(file.path);
            if (paths.has(path)) throw new Error(`Duplicate project file: ${path}`);
            paths.add(path);
            this.put(root, `project/${path}`, typeof file.content === 'string' ? encoder.encode(file.content) : new Uint8Array(file.bytes));
        }
        const sources = (request.sources || [request.entry || 'main.cpp']).map(projectPath);
        if (!sources.length || sources.some(path => !paths.has(path))) throw new Error('Select a source file from the project.');
        const name = (request.name || 'SwApplication').replace(/[^a-zA-Z0-9_-]/g, '_') || 'SwApplication';
        const output = [];
        this.currentOutput = output;
        let runTool = (asset, argv) => this.runTool(asset, argv, root, output);
        let readOutput = path => this.get(root, path);
        let runLinker;
        if (target.runtime === 'binji' || target.linkerRuntime === 'binji') {
            const {API} = await import(new URL(target.runtimeScript, this.manifestUrl).href);
            const api = new API({
                memfs: target.memfs.path, sysroot: 'empty.tar',
                compileStreaming: () => this.module(target.memfs),
                readBuffer: async () => new ArrayBuffer(1024),
                hostWrite: text => {
                    output.push(text);
                    this.emit({type: 'output', stream: 'stdout', text});
                },
            });
            await api.ready;
            const copy = (directory, parent = '') => {
                for (const [name, entry] of directory.contents) {
                    const path = parent ? `${parent}/${name}` : name;
                    if (entry.contents) { api.memfs.addDirectory(path); copy(entry, path); }
                    else if (target.runtime === 'binji' || /\.(a|lib|o|obj|def|so(?:\.[0-9]+)*)$/i.test(path)) {
                        try { api.memfs.addFile(path, entry.data); }
                        catch (error) { throw new Error(`Unable to stage linker input ${path}: ${error.message}`); }
                    }
                }
            };
            copy(root);
            const relativeArgument = argument => {
                if (/^\/(?:out|libpath|def|implib):\//i.test(argument)) return argument.replace(':/', ':');
                if (Array.from(root.contents.keys()).some(name => argument === `/${name}` || argument.startsWith(`/${name}/`))) return argument.slice(1);
                return argument;
            };
            const legacyRun = async (asset, argv) => {
                try { await api.run(await this.module(asset), ...argv.map(relativeArgument)); }
                catch (error) { error.exitCode = error.code || 1; throw error; }
            };
            runLinker = legacyRun;
            if (target.runtime === 'binji') runTool = legacyRun;
            readOutput = path => new Uint8Array(api.memfs.getFileContents(path.replace(/^\//, '')));
            target.copyObjectToLinker = (path, bytes) => api.memfs.addFile(path.replace(/^\//, ''), bytes);
        }
        let nativeModule;
        if (target.runtime === 'emscripten') {
            const compiler = target.compiler;
            const scriptUrl = new URL(compiler.script, this.manifestUrl);
            nativeModule = await cachedLoad(this.nativeCompilers, scriptUrl.href, async () => {
                this.emit({type: 'status', text: 'Loading the native compiler…'});
                await verifiedBytes(scriptUrl, compiler.scriptSha256);
                const {default: factory} = await import(scriptUrl.href);
                const wasmBinary = await verifiedBytes(new URL(compiler.path, this.manifestUrl), compiler.sha256);
                const data = await verifiedBytes(new URL(compiler.data, this.manifestUrl), compiler.dataSha256);
                return factory({
                    wasmBinary, noInitialRun: true,
                    getPreloadedPackage: () => data.buffer,
                    locateFile: name => new URL(name, scriptUrl).href,
                    print: text => { this.currentOutput.push(`${text}\n`); this.emit({type: 'output', stream: 'stdout', text: `${text}\n`}); },
                    printErr: text => { this.currentOutput.push(`${text}\n`); this.emit({type: 'output', stream: 'stderr', text: `${text}\n`}); },
                });
            });
            const remove = path => {
                if (!nativeModule.FS.analyzePath(path).exists) return;
                for (const name of nativeModule.FS.readdir(path)) {
                    if (name === '.' || name === '..') continue;
                    const child = `${path}/${name}`;
                    if (nativeModule.FS.isDir(nativeModule.FS.stat(child).mode)) remove(child);
                    else nativeModule.FS.unlink(child);
                }
                nativeModule.FS.rmdir(path);
            };
            remove('/project');
            remove('/build');
            const copy = (directory, parent = '') => {
                for (const [name, entry] of directory.contents) {
                    const path = `${parent}/${name}`;
                    if (entry.contents) { nativeModule.FS.mkdirTree(path); copy(entry, path); }
                    else nativeModule.FS.writeFile(path, entry.data);
                }
            };
            copy(root);
            runTool = async (_asset, argv) => {
                const quote = value => `'${value.replace(/'/g, `'"'"'`)}'`;
                const code = nativeModule.ccall(compiler.api || 'run_command', 'number', ['string'], [argv.map(quote).join(' ')]);
                if (code !== 0) {
                    const error = new Error(`clang failed with exit code ${code}.`);
                    error.exitCode = code;
                    throw error;
                }
            };
        }
        const objects = [];
        const flags = target.compileArguments || [];
        const includes = (target.includeDirs || []).flatMap(path => [nativeModule ? '-isystem' : '-internal-isystem', path]);
        const definitions = (target.definitions || []).map(value => `-D${value}`);
        const formDimension = (value, fallback) => Number.isInteger(value) && value > 0 && value <= 65536 ? value : fallback;
        const formSize = {width: formDimension(request.formSize?.width, 640),
            height: formDimension(request.formSize?.height, 420)};
        if (request.profile === 'swstack') definitions.push('-DSWCREATOR_PROJECT_RUNTIME=1',
            `-DSWCREATOR_FORM_WIDTH=${formSize.width}`, `-DSWCREATOR_FORM_HEIGHT=${formSize.height}`);
        if (sideModule && request.profile === 'core') definitions.push('-DSWCREATOR_PROJECT_RUNTIME=1');
        const windowFactory = request.profile === 'swstack' && sources.some(path =>
            /\bcreator_create_window\s*\(/.test(files.find(file => projectPath(file.path) === path)?.content || ''));
        if (windowFactory) definitions.push('-DSWCREATOR_HAS_WINDOW_FACTORY=1');
        for (let index = 0; index < sources.length; ++index) {
            const path = sources[index];
            this.emit({type: 'status', text: `Compiling ${path}…`});
            const object = `/build/source-${index}.o`;
            await runTool(target.compiler || this.manifest.compiler, [
                ...(nativeModule ? [target.compiler.driver || 'clang++', `--target=${target.triple}`, '-c'] : ['clang', '-cc1', '-triple', target.triple, '-emit-obj']),
                /\.c$/.test(path) ? '-std=c11' : '-std=c++17', '-O1',
                '-I', '/project', ...includes, ...definitions, ...flags,
                '-o', object, '-x', /\.c$/.test(path) ? 'c' : 'c++', `/project/${path}`,
            ]);
            if (nativeModule && target.copyObjectToLinker) {
                const bytes = nativeModule.FS.readFile(object);
                target.copyObjectToLinker(object, target.kind === 'coff' ? stripUnsupportedCoffExclusions(bytes) : bytes);
            }
            objects.push(object);
        }
        for (const source of target.runtimeSources || []) {
            const object = `/build/runtime-${objects.length}.o`;
            await runTool(target.compiler || this.manifest.compiler, [
                ...(nativeModule ? [target.compiler.driver || 'clang++', `--target=${target.triple}`, '-c'] : ['clang', '-cc1', '-triple', target.triple, '-emit-obj']), '-O1',
                ...includes, ...definitions, ...flags, '-o', object, '-x', /\.(cpp|cc|cxx)$/.test(source) ? 'c++' : 'c', source,
            ]);
            if (nativeModule && target.copyObjectToLinker) {
                const bytes = nativeModule.FS.readFile(object);
                target.copyObjectToLinker(object, target.kind === 'coff' ? stripUnsupportedCoffExclusions(bytes) : bytes);
            }
            objects.push(object);
        }
        this.emit({type: 'status', text: 'Linking the application…'});
        const windows = target.kind === 'coff';
        const linux = target.kind === 'elf';
        const path = `/build/${name}${windows ? '.exe' : linux ? '' : '.wasm'}`;
        const linker = target.linker || this.manifest.linker;
        const arguments_ = windows
            ? ['lld-link', `/out:${path}`, ...objects, ...(target.linkArguments || [])]
            : linux ? ['ld.lld', '-o', path, ...(target.startObjects || []), ...objects,
                ...(target.libraryDirs || []).map(dir => `-L${dir}`), ...(target.linkArguments || [])]
            : ['wasm-ld', '-o', path, ...(target.libraryDirs || []).map(dir => `-L${dir}`),
                ...(target.startObjects || []), ...objects, ...(target.linkArguments || []),
                ...(sideModule && windowFactory ? ['--export=creator_create_window'] : [])];
        await (runLinker || runTool)(linker, arguments_);
        const bytes = readOutput(path);
        const magic = windows ? bytes[0] === 77 && bytes[1] === 90
            : linux ? bytes[0] === 127 && bytes[1] === 69 && bytes[2] === 76 && bytes[3] === 70
            : bytes[0] === 0 && bytes[1] === 97 && bytes[2] === 115 && bytes[3] === 109;
        if (!magic) throw new Error('The linker produced an invalid application.');
        return {
            exitCode: 0, output: output.join(''), profile: target.kind,
            projectProfile: request.profile || 'console', formSize,
            artifacts: [{path: path.split('/').pop(), bytes, mime: windows ? 'application/vnd.microsoft.portable-executable'
                : linux ? 'application/x-executable' : 'application/wasm'}],
        };
    }
}
