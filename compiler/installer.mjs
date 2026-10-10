// Browser-side packaging. Windows uses SwSetup's archive format and native
// runtime; Linux carries an ELF application and its matching shared runtime.
import {projectPath} from './toolchain.mjs';

const encoder = new TextEncoder();
const encode = value => encoder.encode(value);
const join = parts => {
    const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
};
const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const safePath = value => {
    if (/[:\x00-\x1f\x7f]/.test(value)) throw new Error('Installer paths cannot contain colons or control characters.');
    return projectPath(value);
};
const fileBytes = file => typeof file.content === 'string' ? encode(file.content) : new Uint8Array(file.bytes);
const strings = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
const glob = pattern => new RegExp('^' + pattern.split('/').map(part => part === '**' ? '.*'
    : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')).join('/').replace(/\.\*\//g, '(?:.*/)?') + '$');

function defaultSpec(request, executable) {
    const name = request.name || 'Application';
    const id = ('app.' + name).replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase();
    return {schema: 'swsetup/1', product: {id, name, publisher: '', version: '1.0.0', mainExecutable: executable},
        install: {scope: 'user', userDirectory: '{LocalAppData}\\Programs\\{ProductName}', machineDirectory: '{ProgramFiles}\\{ProductName}'},
        sources: [{id: 'app', type: 'cmake-target', target: request.cmakeTarget || name}],
        components: [{id: 'app', name, required: true, selected: true}], variables: [],
        deploy: [{id: 'app-files', action: 'copy', source: 'app', to: '{InstallDir}', component: 'app'},
                 {id: 'shortcut', action: 'shortcut', name: '{ProductName}', target: '{InstallDir}\\' + executable,
                  startMenu: true, desktop: true, component: 'app'}],
        appearance: {accent: '#0078D4', oneClick: true, launchAtEnd: true, language: 'auto'},
        output: {file: 'dist/{ProductName}-{Version}-Setup.exe', compression: 'balanced'}};
}

function collectPayload(request, application) {
    const files = new Map((request.files || []).map(file => [safePath(file.path), fileBytes(file)]));
    const document = files.get('installer/installer.json');
    const spec = document ? JSON.parse(new TextDecoder().decode(document)) : defaultSpec(request, application.path);
    if (spec.schema !== 'swsetup/1' || !spec.product || !Array.isArray(spec.sources) || !Array.isArray(spec.deploy))
        throw new Error('Invalid installer/installer.json: expected the swsetup/1 schema, product, sources and deploy rules.');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(spec.product.id || ''))
        throw new Error('The installer needs a valid product.id.');
    if (typeof spec.product.name !== 'string' || !spec.product.name.trim() || /[\x00-\x1f\x7f]/.test(spec.product.name))
        throw new Error('The installer needs a product name without control characters.');
    if (spec.output?.signing?.enabled && spec.output.signing.enabled !== 'false')
        throw new Error('Browser installers are unsigned. Disable output.signing.enabled and sign the downloaded installer with a native signing tool.');
    if (spec.product.version === '@cmake') {
        const cmake = new TextDecoder().decode(files.get('CMakeLists.txt') || new Uint8Array());
        spec.product.version = /\bproject\s*\([^)]*\bVERSION\s+([\d.]+)/i.exec(cmake)?.[1] || '1.0.0';
    }
    let executable = spec.product.mainExecutable || application.path;
    if (request.target === 'linux') executable = executable.replace(/\.exe$/i, '');
    executable = safePath(executable.replace(/\\/g, '/'));
    spec.product.mainExecutable = executable;
    const entries = [];
    const ids = new Set();
    for (const source of spec.sources) {
        if (!/^[a-zA-Z0-9._-]+$/.test(source.id || '') || ids.has(source.id)) throw new Error('Invalid or duplicate installer source ID.');
        ids.add(source.id);
        const prefix = source.prefix ? safePath(source.prefix.replace(/\\/g, '/').replace(/\/$/, '')) + '/' : '';
        const include = strings(source.include).map(glob), exclude = strings(source.exclude).map(glob);
        let candidates = [];
        if (source.type === 'cmake-target') {
            if (request.cmakeTarget && source.target !== request.cmakeTarget && source.target !== request.name)
                throw new Error(`The browser build does not provide the installer target ${source.target}. Select that program before packaging.`);
            candidates = [[prefix ? executable.split('/').pop() : executable, application.bytes]];
            if (include.length) candidates.push(...Array.from(files).filter(([path]) => include.some(pattern => pattern.test(path))));
        } else if (source.type === 'file' || source.type === 'directory') {
            let path = source.path || '';
            if (request.projectPath && path.startsWith(request.projectPath + '/')) path = path.slice(request.projectPath.length + 1);
            path = safePath(path.replace(/\\/g, '/').replace(/\/$/, ''));
            candidates = source.type === 'file' ? (files.has(path) ? [[path.split('/').pop(), files.get(path)]] : [])
                : Array.from(files).filter(([name]) => name.startsWith(path + '/')).map(([name, bytes]) => [name.slice(path.length + 1), bytes]);
            if (!candidates.length) throw new Error(`Installer source not found in the project: ${path}`);
        } else throw new Error(`Unsupported installer source type: ${source.type}`);
        for (const [path, bytes] of candidates) {
            if ((source.type === 'directory' && include.length && !include.some(pattern => pattern.test(path))) || exclude.some(pattern => pattern.test(path))) continue;
            entries.push({group: 'src:' + source.id, path: safePath(prefix + path), bytes});
        }
    }
    if (!entries.length) throw new Error('The installer would contain no application files.');
    for (const [path, bytes] of files) {
        if (path.startsWith('installer/') && path !== 'installer/installer.json')
            entries.push({group: 'ui', path: safePath(path.slice('installer/'.length)), bytes});
    }
    for (const flow of Object.values(spec.pages || {})) {
        for (const page of flow) if (page.form && !files.has('installer/' + safePath(page.form)))
            throw new Error(`Installer page not found: ${page.form}`);
    }
    for (const key of ['license', 'image', 'icon']) {
        const path = spec.appearance?.[key];
        if (path && !files.has('installer/' + safePath(path))) throw new Error(`Installer ${key} not found: ${path}`);
    }
    return {spec, entries, executable};
}

async function sdkFiles(engine, targetName) {
    const target = engine.manifest.targets[targetName];
    if (!target?.sdkManifest) throw new Error(`The ${targetName} SDK is not packaged for this site.`);
    const url = new URL(target.sdkManifest, engine.manifestUrl);
    const manifest = await engine.sdkManifest(url, `The ${targetName} SDK is missing.`);
    const files = new Map();
    for (const asset of manifest.archives || []) for (const [path, bytes] of await engine.archive(asset, url)) files.set(path, bytes);
    return {manifest, files};
}

async function compress(bytes, format) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function windowsInstaller(engine, request, payload) {
    const {manifest, files} = await sdkFiles(engine, 'windows');
    const runtime = manifest.installerRuntime;
    if (!runtime?.bootstrap || !runtime.files?.length) throw new Error('The Windows SDK is missing its installer runtime. Rebuild the complete browser SDK.');
    const bootstrap = files.get(runtime.bootstrap);
    if (!bootstrap || bootstrap[0] !== 77 || bootstrap[1] !== 90) throw new Error('Invalid Windows setup launcher.');
    const entries = runtime.files.map(file => {
        const bytes = files.get(file.source);
        if (!bytes) throw new Error(`Missing setup runtime file: ${file.source}`);
        return {group: 'runtime', path: safePath(file.path), bytes};
    });
    entries.push({group: 'manifest', path: 'installer.json', bytes: encode(JSON.stringify(payload.spec, null, 2))}, ...payload.entries);
    const parts = [bootstrap], index = [], seen = new Set();
    let offset = bootstrap.length;
    for (const entry of entries) {
        const key = entry.group.toLowerCase() + ':' + entry.path.toLowerCase();
        if (seen.has(key)) throw new Error(`Duplicate installer entry: ${entry.path}`);
        seen.add(key);
        let stored = entry.bytes, method = 0;
        if (payload.spec.output?.compression !== 'none') {
            const packed = await compress(entry.bytes, 'deflate');
            if (packed.length < stored.length) { stored = packed; method = 1; }
        }
        const group = encode(entry.group), path = encode(entry.path);
        if (group.length > 65535 || path.length > 65535) throw new Error('Installer entry name is too long.');
        const record = new Uint8Array(2 + group.length + 2 + path.length + 24 + 1 + 32);
        const view = new DataView(record.buffer);
        view.setUint16(0, group.length, true); record.set(group, 2);
        let at = 2 + group.length;
        view.setUint16(at, path.length, true); record.set(path, at + 2); at += 2 + path.length;
        view.setBigUint64(at, BigInt(offset), true);
        view.setBigUint64(at + 8, BigInt(stored.length), true);
        view.setBigUint64(at + 16, BigInt(entry.bytes.length), true);
        record[at + 24] = method; record.set(await digest(entry.bytes), at + 25);
        index.push(record); parts.push(stored); offset += stored.length;
    }
    const directory = join(index), footer = new Uint8Array(48), view = new DataView(footer.buffer);
    footer.set(encode('SWSETUP1'));
    view.setBigUint64(8, BigInt(bootstrap.length), true);
    view.setBigUint64(16, BigInt(offset), true);
    view.setBigUint64(24, BigInt(directory.length), true);
    view.setUint32(32, entries.length, true); footer.set(encode('SWSETEND'), 40);
    parts.push(directory, new Uint8Array((8 - (offset + directory.length) % 8) % 8), footer);
    const output = payload.spec.output?.file || '{ProductName}-{Version}-Setup.exe';
    const name = output.replaceAll('{ProductName}', payload.spec.product.name).replaceAll('{Version}', payload.spec.product.version)
        .replace(/\\/g, '/').split('/').pop().replace(/[^\p{L}\p{N}._ -]/gu, '_');
    return {path: name.endsWith('.exe') ? name : name + '.exe', bytes: join(parts), mime: 'application/vnd.microsoft.portable-executable'};
}

function tar(entries) {
    const parts = [];
    for (const entry of entries) {
        const header = new Uint8Array(512);
        let name = safePath(entry.path), prefix = '';
        if (encode(name).length > 100) {
            const slash = name.lastIndexOf('/');
            if (slash >= 0) { prefix = name.slice(0, slash); name = name.slice(slash + 1); }
        }
        if (encode(name).length > 100 || encode(prefix).length > 155) throw new Error('Linux installer path is too long: ' + entry.path);
        const field = (offset, size, value) => header.set(encode(value).subarray(0, size), offset);
        const octal = (offset, size, value) => field(offset, size, value.toString(8).padStart(size - 1, '0') + '\0');
        field(0, 100, name); octal(100, 8, entry.executable ? 0o755 : 0o644);
        octal(108, 8, 0); octal(116, 8, 0); octal(124, 12, entry.bytes.length); octal(136, 12, 0);
        header.fill(32, 148, 156); header[156] = 48; field(257, 6, 'ustar\0'); field(263, 2, '00'); field(345, 155, prefix);
        const checksum = header.reduce((sum, byte) => sum + byte, 0);
        field(148, 8, checksum.toString(8).padStart(6, '0') + '\0 ');
        parts.push(header, entry.bytes, new Uint8Array((512 - entry.bytes.length % 512) % 512));
    }
    return join([...parts, new Uint8Array(1024)]);
}

const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";

function uninstallScript(id) {
    return `#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
id=${shellQuote(id)}
[ "$(cat "$root/.softi-product" 2>/dev/null)" = "$id" ] || { echo 'This directory is not owned by this installer.' >&2; exit 1; }
[ -z "$(find "$root" -type l -print -quit)" ] || { echo 'Remove symbolic links from the installation directory before uninstalling.' >&2; exit 1; }
while IFS= read -r record; do
    expected=\${record%%  *}
    relative=\${record#*  }
    case "$relative" in ''|/*|..|../*|*/../*|*/..|.|./*|*/./*) echo 'Invalid installed-file inventory.' >&2; exit 1 ;; esac
    if [ -f "$root/$relative" ]; then
        actual=$(sha256sum "$root/$relative"); actual=\${actual%% *}
        if [ "$actual" = "$expected" ]; then rm -- "$root/$relative"; else printf 'Preserved modified file: %s\\n' "$relative"; fi
    fi
done < "$root/.softi-files.sha256"
link="$HOME/.local/bin/$id"
[ "$(readlink "$link" 2>/dev/null || true)" != "$root/launch" ] || rm -- "$link"
desktop="\${XDG_DATA_HOME:-$HOME/.local/share}/applications/$id.desktop"
if [ -f "$desktop" ] && grep -Fqx "X-Softi-InstallDir=$root" "$desktop"; then rm -- "$desktop"; fi
while IFS= read -r record; do
    relative=\${record#*  }; directory=$(dirname -- "$relative")
    while [ "$directory" != . ]; do
        rmdir -- "$root/$directory" 2>/dev/null || break
        directory=$(dirname -- "$directory")
    done
done < "$root/.softi-files.sha256"
rm -- "$root/.softi-files.sha256" "$root/.softi-product"
rmdir -- "$root" 2>/dev/null || true
printf 'Uninstalled %s. Modified and unrelated files are preserved.\\n' "$id"
`;
}

function installScript(spec) {
    const id = shellQuote(spec.product.id), name = shellQuote(spec.product.name || spec.product.id);
    return `#!/bin/sh
set -eu
id=${id}
name=${name}
install_dir="\${XDG_DATA_HOME:-$HOME/.local/share}/$id"
shortcuts=1
action=install
while [ "$#" -gt 0 ]; do
    case "$1" in
        --install-dir|--prefix) [ "$#" -ge 2 ] || exit 2; install_dir=$2; shift 2 ;;
        --scope) [ "$#" -ge 2 ] && [ "$2" = user ] || { echo 'Linux browser installers support --scope user.' >&2; exit 2; }; shift 2 ;;
        --silent) shift ;;
        --no-shortcuts) shortcuts=0; shift ;;
        --repair) action=repair; shift ;;
        --uninstall) action=uninstall; shift ;;
        --help) echo "Usage: sh $0 [--install-dir DIR] [--silent] [--repair|--uninstall] [--no-shortcuts]"; exit 0 ;;
        *) printf 'Unknown option: %s\\n' "$1" >&2; exit 2 ;;
    esac
done
case "$install_dir" in ''|/|.|..|*/../*|*/..|*/./*) echo 'Choose a dedicated installation directory.' >&2; exit 2 ;; esac
[ "$(printf '%s' "$install_dir" | LC_ALL=C tr -d '[:cntrl:]')" = "$install_dir" ] || { echo 'The installation directory contains control characters.' >&2; exit 2; }
case "$install_dir" in /*) ;; *) install_dir="$PWD/$install_dir" ;; esac
mkdir -p -- "$(dirname -- "$install_dir")"
parent=$(CDPATH= cd -- "$(dirname -- "$install_dir")" && pwd)
leaf=$(basename -- "$install_dir")
case "$leaf" in /|.|..) echo 'Choose a dedicated installation directory.' >&2; exit 2 ;; esac
install_dir="\${parent%/}/$leaf"
if [ "$action" = uninstall ]; then exec sh "$install_dir/uninstall.sh"; fi
if [ -L "$install_dir" ]; then echo 'The installation directory cannot be a symbolic link.' >&2; exit 1; fi
if [ -d "$install_dir" ] && [ "$(cat "$install_dir/.softi-product" 2>/dev/null || true)" != "$id" ]; then
    [ -z "$(ls -A -- "$install_dir")" ] || { echo 'The destination contains files belonging to another application.' >&2; exit 1; }
fi
if [ -d "$install_dir" ] && [ -n "$(find "$install_dir" -type l -print -quit)" ]; then
    echo 'Remove symbolic links from the installation directory before updating.' >&2; exit 1
fi
stage=$(mktemp -d "$parent/.softi-setup.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
payload_line=$(awk '/^__SOFTI_ARCHIVE__$/ { print NR+1; exit }' "$0")
[ -n "$payload_line" ] || { echo 'The installer payload is missing.' >&2; exit 1; }
tail -n +"$payload_line" "$0" | tar -xz -C "$stage"
(cd "$stage" && sha256sum -c .softi-files.sha256)
if [ "$(cat "$install_dir/.softi-product" 2>/dev/null || true)" = "$id" ]; then
    while IFS= read -r record; do
        expected=\${record%%  *}; relative=\${record#*  }
        case "$relative" in ''|/*|..|../*|*/../*|*/..|.|./*|*/./*) echo 'Invalid installed-file inventory.' >&2; exit 1 ;; esac
        if [ -f "$install_dir/$relative" ]; then
            actual=$(sha256sum "$install_dir/$relative"); actual=\${actual%% *}
            if [ "$actual" != "$expected" ]; then
                mkdir -p -- "$install_dir/.softi-backup/$(dirname -- "$relative")"
                cp -p -- "$install_dir/$relative" "$install_dir/.softi-backup/$relative"
            fi
        fi
    done < "$install_dir/.softi-files.sha256"
fi
if [ ! -d "$install_dir" ]; then
    mv -- "$stage" "$install_dir"
elif [ -z "$(ls -A -- "$install_dir")" ]; then
    rmdir -- "$install_dir"; mv -- "$stage" "$install_dir"
else
    cp -R -- "$stage/." "$install_dir/"
fi
printf '%s\\n' "$id" > "$install_dir/.softi-product"
if [ "$shortcuts" = 1 ]; then
    mkdir -p -- "$HOME/.local/bin" "\${XDG_DATA_HOME:-$HOME/.local/share}/applications"
    link="$HOME/.local/bin/$id"
    if [ ! -e "$link" ] && [ ! -L "$link" ]; then ln -s -- "$install_dir/launch" "$link"; fi
    desktop="\${XDG_DATA_HOME:-$HOME/.local/share}/applications/$id.desktop"
    quoted=$(printf '%s' "$install_dir" | sed 's/[\\\\"]/\\\\&/g')
    printf '[Desktop Entry]\\nType=Application\\nName=%s\\nExec="%s/launch"\\nTerminal=${spec.appearance?.terminal ? 'true' : 'false'}\\nX-Softi-InstallDir=%s\\n' "$name" "$quoted" "$install_dir" > "$desktop"
fi
printf 'Installed %s in %s\\nRun: %s/launch\\nUninstall: sh %s/uninstall.sh\\n' "$name" "$install_dir" "$install_dir" "$install_dir"
exit 0
__SOFTI_ARCHIVE__
`;
}

async function linuxInstaller(engine, request, payload) {
    const {manifest, files} = await sdkFiles(engine, 'linux');
    const installed = new Map();
    const add = (path, bytes, executable = false) => {
        safePath(path);
        if (installed.has(path)) throw new Error('Duplicate Linux install destination: ' + path);
        installed.set(path, {path, bytes, executable});
    };
    // Linux has no Windows registry or drive-letter namespace. Reject rules
    // that cannot be represented rather than producing a partial installer.
    for (const rule of payload.spec.deploy) {
        if (rule.when && rule.when !== 'true') throw new Error('Linux installers do not support conditional deploy rules: ' + rule.id);
        if (rule.action === 'shortcut') continue;
        if (rule.action !== 'copy')
            throw new Error(`Linux installers currently support copy and shortcut rules; unsupported rule: ${rule.id || rule.action}`);
        const destination = (rule.to || '').replace(/\\/g, '/');
        if (destination !== '{InstallDir}' && !destination.startsWith('{InstallDir}/'))
            throw new Error('Linux copy destinations must be inside {InstallDir}.');
        const prefix = destination.slice('{InstallDir}'.length).replace(/^\//, '');
        const [source, filter] = (rule.source || '').split(':');
        let copied = 0;
        for (const entry of payload.entries.filter(entry => entry.group === 'src:' + source && (!filter || glob(filter).test(entry.path)))) {
            const path = (prefix ? prefix + '/' : '') + entry.path;
            if (path.startsWith('.softi-')) throw new Error('Reserved Linux installer path: ' + path);
            add(path, entry.bytes, entry.path === payload.executable);
            ++copied;
        }
        if (!copied) throw new Error('Linux copy rule contains no files: ' + rule.source);
    }
    if (!installed.has(payload.executable)) throw new Error('The main executable must be installed at {InstallDir}/' + payload.executable);
    for (const path of manifest.runtimeFiles || []) {
        const bytes = files.get(path.replace(/^\//, ''));
        if (!bytes) throw new Error('Missing Linux runtime library: ' + path);
        add('lib/' + path.split('/').pop(), bytes, true);
    }
    if (!installed.has('lib/ld-linux-x86-64.so.2')) throw new Error('The Linux SDK is missing its dynamic loader.');
    const launch = `#!/bin/sh\nset -eu\nroot=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$root/lib/ld-linux-x86-64.so.2" --library-path "$root/lib" "$root/"${shellQuote(payload.executable)} "$@"\n`;
    add('launch', encode(launch), true);
    add('uninstall.sh', encode(uninstallScript(payload.spec.product.id)), true);
    add('installer.json', encode(JSON.stringify(payload.spec, null, 2)));
    let inventory = '';
    for (const entry of installed.values()) inventory += hex(await digest(entry.bytes)) + '  ' + entry.path + '\n';
    add('.softi-files.sha256', encode(inventory));
    const bytes = join([encode(installScript(payload.spec)), await compress(tar(Array.from(installed.values())), 'gzip')]);
    const name = (payload.spec.product.name + '-' + payload.spec.product.version + '-Setup.run').replace(/[^\p{L}\p{N}._ -]/gu, '_');
    return {path: name, bytes, mime: 'application/octet-stream'};
}

export async function buildInstaller(engine, request, result) {
    if (request.target !== 'windows' && request.target !== 'linux') throw new Error('Select Windows or Linux before building an installer.');
    if (result.artifacts.length !== 1) throw new Error('Expected one compiled application to package.');
    engine.emit({type: 'status', text: 'Packaging the installer…'});
    const payload = collectPayload(request, result.artifacts[0]);
    const artifact = request.target === 'windows' ? await windowsInstaller(engine, request, payload)
        : await linuxInstaller(engine, request, payload);
    return {...result, installer: true, product: payload.spec.product, artifacts: [artifact]};
}
