(function () {
    'use strict';
    const scriptBase = new URL('.', document.currentScript.src);
    const module = window.Module || (window.Module = {});
    module.swCreatorBuildEvents = module.swCreatorBuildEvents || [];
    let worker = null;
    let pending = null;
    let sequence = 0;
    let preview = null;
    let cancelPreviewWait = null;
    let previewWorkbench = null;

    function event(text, busy, kind = 'status', details = {}) {
        // The shared build panel displays plain text, like a native compiler
        // pipe. Linker terminal colour sequences have no meaning in this view.
        text = String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
        const detail = {text, busy, kind, ...details};
        module.swCreatorLastBuildEvent = detail;
        module.swCreatorBuildEvents.push(detail);
        // The C++ UI drains this queue on its ordinary event loop.
        window.dispatchEvent(new CustomEvent('swcreator:build-event', {detail}));
    }

    function reportError(error) {
        if (!error || typeof error !== 'object') error = new Error(String(error));
        if (!error.buildEventReported) {
            event(String(error.message || error), false, 'error', {exitCode: error.exitCode || 1, buildId: error.buildId});
            error.buildEventReported = true;
        }
        return error;
    }

    function compilerWorker() {
        if (worker) return worker;
        worker = new Worker(new URL('worker.mjs', scriptBase), {type: 'module'});
        const created = worker;
        worker.onmessage = ({data}) => {
            if (worker !== created || !pending || pending.id !== data.id) return;
            if (data.type === 'output') event(data.text, true, 'output', {buildId: pending.buildId});
            else if (data.type === 'status') event(data.text, true, 'status', {buildId: pending.buildId});
            else if (data.type === 'error') {
                const current = pending;
                pending = null;
                const error = new Error(data.text);
                error.exitCode = data.exitCode || 1;
                error.buildId = current.buildId;
                current.reject(reportError(error));
            } else if (data.type === 'result') {
                const current = pending;
                pending = null;
                event('Compilation succeeded.', false, 'complete', {exitCode: data.result.exitCode || 0, buildId: current.buildId});
                current.resolve(data.result);
            }
        };
        worker.onerror = error => {
            if (worker !== created) return;
            const current = pending;
            pending = null;
            worker.terminate();
            worker = null;
            const failure = new Error(error.message || 'The compiler worker stopped.');
            failure.buildId = current?.buildId;
            reportError(failure);
            if (current) current.reject(failure);
        };
        return worker;
    }

    module.swCreatorDownload = function (name, content, mime = 'application/octet-stream') {
        const url = URL.createObjectURL(new Blob([content], {type: mime}));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name.split('/').pop();
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
    };

    function project(profile) {
        const pointer = module.ccall('swcreator_web_project_json', 'number', ['string'], [profile || '']);
        return JSON.parse(module.UTF8ToString(pointer));
    }

    function lastError(fallback) {
        const pointer = module.ccall('swcreator_web_last_error', 'number', [], []);
        return module.UTF8ToString(pointer) || fallback;
    }

    function prepareImport(path, content, project) {
        return new Promise(resolve => {
            module.swCreatorImportDecision = resolve;
            module.ccall('swcreator_web_prepare_import', null, ['string', 'string', 'number'], [path, content, project ? 1 : 0]);
        });
    }

    // A file selection grants access only to that file. Ask for the containing
    // directory as well, using a real DOM click so browser user activation is
    // preserved even though the C++ workbench dispatches input asynchronously.
    module.swCreatorChooseProject = function ({english = false, dark = true} = {}) {
        if (module.swCreatorImportDecision || document.getElementById('project-import')) return false;
        const tr = (fr, en) => english ? en : fr;
        const dialog = document.createElement('dialog');
        dialog.id = 'project-import';
        dialog.classList.toggle('light', !dark);
        dialog.setAttribute('aria-labelledby', 'project-import-title');
        dialog.innerHTML = `<h2 id="project-import-title"></h2><p id="project-import-description"></p>
            <input id="project-cmake" type="file" accept=".txt" hidden>
            <button id="project-choose-cmake" class="project-step" type="button"></button>
            <input id="project-directory" type="file" webkitdirectory multiple hidden>
            <button id="project-choose-directory" class="project-step project-import-primary" type="button" disabled></button>
            <p id="project-import-status" role="status" aria-live="polite"></p>
            <div class="project-import-actions"><button id="project-import-cancel" type="button"></button></div>`;
        const find = id => dialog.querySelector('#' + id);
        find('project-import-title').textContent = tr('Ouvrir un projet CMake', 'Open a CMake project');
        find('project-import-description').textContent = tr(
            'Choisissez le CMakeLists.txt, puis son dossier pour importer les sources, sous-dossiers et ressources du projet.',
            'Choose CMakeLists.txt, then its folder to import the project sources, subfolders and resources.');
        find('project-choose-cmake').textContent = tr('1. Choisir CMakeLists.txt', '1. Choose CMakeLists.txt');
        find('project-choose-directory').textContent = tr('2. Importer le dossier du projet', '2. Import the project folder');
        find('project-import-cancel').textContent = tr('Annuler', 'Cancel');
        let cmake = null;
        let closed = false;
        const status = (text, error = false) => {
            find('project-import-status').textContent = text;
            find('project-import-status').toggleAttribute('data-error', error);
        };
        const closeDialog = () => { closed = true; dialog.close(); };
        dialog.addEventListener('close', () => { closed = true; dialog.remove(); module.canvas?.focus(); });
        dialog.addEventListener('cancel', () => { closed = true; });
        find('project-import-cancel').onclick = closeDialog;
        find('project-choose-cmake').onclick = () => find('project-cmake').click();
        find('project-choose-directory').onclick = () => find('project-directory').click();
        find('project-cmake').onchange = () => {
            cmake = find('project-cmake').files[0] || null;
            if (cmake && cmake.name !== 'CMakeLists.txt') {
                cmake = null;
                status(tr('Choisissez un fichier nommé CMakeLists.txt.', 'Choose a file named CMakeLists.txt.'), true);
            } else if (cmake) status(tr('CMakeLists.txt sélectionné. Choisissez maintenant le dossier qui le contient.',
                'CMakeLists.txt selected. Now choose the folder containing it.'));
            find('project-choose-directory').disabled = !cmake;
        };
        find('project-directory').onchange = async () => {
            const selected = Array.from(find('project-directory').files);
            find('project-directory').value = '';
            if (!selected.length || !cmake) return;
            find('project-choose-cmake').disabled = true;
            find('project-choose-directory').disabled = true;
            try {
                const root = selected[0].webkitRelativePath.split('/')[0];
                const candidates = selected.map(file => ({file, path:file.webkitRelativePath.slice(root.length + 1)}));
                const rootCmake = candidates.find(item => item.path === 'CMakeLists.txt');
                if (!rootCmake || rootCmake.file.size !== cmake.size || await rootCmake.file.text() !== await cmake.text())
                    throw new Error(tr('Ce dossier ne contient pas le CMakeLists.txt sélectionné. Choisissez son dossier parent.',
                        'This folder does not contain the selected CMakeLists.txt. Choose its containing folder.'));
                const kept = candidates.filter(({path}) => !path.split('/').slice(0, -1).some(part =>
                    part === '.swcreator' || part === 'node_modules' || /^(?:build|cmake-build)(?:$|[-_])/i.test(part)));
                if (kept.length > 10000 || kept.reduce((size, {file}) => size + file.size, 0) > 256 * 1024 * 1024)
                    throw new Error(tr('Le dépôt dépasse 10 000 fichiers ou 256 Mio.', 'The repository exceeds 10,000 files or 256 MiB.'));
                const snapshot = {version:1, format:'cmake', name:root, files:[]};
                const decoder = new TextDecoder('utf-8', {fatal:true, ignoreBOM:true});
                for (const {file, path} of kept) {
                    if (closed) return;
                    if (file.size > 64 * 1024 * 1024)
                        throw new Error(tr('Fichier trop volumineux : ', 'File too large: ') + path);
                    const bytes = new Uint8Array(await file.arrayBuffer());
                    let content;
                    try { content = decoder.decode(bytes); if (content.includes('\0')) content = null; } catch { content = null; }
                    const imported = {path, content};
                    if (content === null) {
                        let binary = '';
                        for (let offset = 0; offset < bytes.length; offset += 32768)
                            binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
                        imported.content = btoa(binary);
                        imported.encoding = 'base64';
                    }
                    snapshot.files.push(imported);
                    status(tr('Lecture du projet : ', 'Reading project: ') + snapshot.files.length + ' / ' + kept.length);
                }
                if (closed) return;
                const json = JSON.stringify(snapshot);
                // Shared Save/Discard/Cancel dialogs must be reachable while
                // deciding whether to leave the current project.
                closeDialog();
                const accepted = await prepareImport('CMakeLists.txt', json, true);
                if (!accepted) return;
                if (!module.ccall('swcreator_web_import_project', 'number', ['string'], [json]))
                    throw new Error(lastError(tr('Import du projet impossible.', 'Unable to import the project.')));
                event(tr('Projet importé : ', 'Project imported: ') + root + ' (' + snapshot.files.length + tr(' fichiers)', ' files)'), false);
            } catch (error) {
                module.swCreatorImportDecision = null;
                if (!closed) status(error.message || String(error), true);
                else reportError(error);
            } finally {
                if (!closed) {
                    find('project-choose-cmake').disabled = false;
                    find('project-choose-directory').disabled = !cmake;
                }
            }
        };
        document.body.appendChild(dialog);
        dialog.showModal();
        return true;
    };

    module.swCreatorChooseFiles = function () {
        if (module.swCreatorImportDecision || document.getElementById('project-import')) return false;
        const input = document.getElementById('files');
        if (!input) return false;
        input.click();
        return true;
    };

    const files = document.getElementById('files');
    if (files) files.addEventListener('change', async () => {
        try {
            for (const file of files.files) {
                if (file.size > 16 * 1024 * 1024) {
                    reportError(new Error('Fichier trop volumineux : ' + file.name));
                    continue;
                }
                const text = await file.text();
                let snapshot = false;
                if (/\.json$/i.test(file.name)) {
                    try { snapshot = Array.isArray(JSON.parse(text).files); } catch {}
                }
                const accepted = await prepareImport(file.name, text, snapshot);
                if (!accepted) {
                    const diagnostic = lastError('');
                    if (diagnostic) reportError(new Error(diagnostic));
                    continue;
                }
                const imported = snapshot
                    ? module.ccall('swcreator_web_import_project', 'number', ['string'], [text])
                    : module.ccall('swcreator_web_import_file', 'number', ['string', 'string'], [file.name, text]);
                if (!imported) reportError(new Error(lastError('Import impossible : ' + file.name)));
                else event('Importé : ' + file.name, false);
            }
        } catch (error) { module.swCreatorImportDecision = null; reportError(error); }
        finally { files.value = ''; }
    });

    module.swCreatorExportProject = function () {
        try {
            if (!module.ccall('swcreator_web_save', 'number', [], [])) {
                throw new Error(lastError('Impossible de sauvegarder le projet.'));
            }
            const snapshot = project();
            module.swCreatorDownload('SwApplication.swcreator.json', JSON.stringify(snapshot, null, 2), 'application/json');
            event('Projet exporté.', false);
            return true;
        } catch (error) { reportError(error); return false; }
    };

    module.swCreatorRequestBuild = async function (request = {}) {
        try {
            if (typeof module.swCreatorCompile !== 'function') throw new Error('Le compilateur local est indisponible.');
            if (!module.ccall('swcreator_web_save', 'number', [], [])) {
                throw new Error(lastError('Impossible de sauvegarder le projet.'));
            }
            const target = request.target || 'web';
            const profile = request.profile || 'swstack';
            const snapshot = Array.isArray(request.files) ? request : project(profile);
            const result = await module.swCreatorCompile({...snapshot, ...request, target, profile});
            module.swCreatorLastBuild = result;
            return result;
        } catch (error) { error.buildId = request.buildId; reportError(error); return null; }
    };
    for (const name of ['swCreatorChooseFiles', 'swCreatorExportProject', 'swCreatorRequestBuild']) {
        window[name] = (...args) => module[name](...args);
    }

    window.addEventListener('beforeunload', event => {
        if (module.swCreatorReady && module.ccall('swcreator_web_has_unsaved_changes', 'number', [], [])) {
            event.preventDefault();
            event.returnValue = '';
        }
    });

    module.swCreatorCancelBuild = function () {
        if (!pending) return;
        worker.terminate();
        worker = null;
        const current = pending;
        pending = null;
        event('Compilation cancelled.', false, 'cancelled', {exitCode: 130, buildId: current.buildId});
        const error = new DOMException('Compilation cancelled.', 'AbortError');
        error.buildEventReported = true;
        error.exitCode = 130;
        error.buildId = current.buildId;
        current.reject(error);
    };

    module.swCreatorClosePreview = function () {
        if (cancelPreviewWait) cancelPreviewWait();
        if (preview) preview.remove();
        preview = null;
        const container = document.getElementById('swcreator-preview');
        if (container) container.hidden = true;
        if (previewWorkbench) {
            const {element, inert, focus} = previewWorkbench;
            previewWorkbench = null;
            element.inert = inert;
            if (focus?.isConnected && !inert) focus.focus();
            else module.canvas?.focus();
        } else module.canvas?.focus();
    };

    function closePreviewOnEscape(event) {
        if (!preview || event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        module.swCreatorClosePreview();
    }
    window.addEventListener('keydown', closePreviewOnEscape, true);

    window.addEventListener('message', ({source, origin, data}) => {
        if (!preview || source !== preview.contentWindow || origin !== location.origin || !data) return;
        if (data.type === 'swcreator:preview-closed') { module.swCreatorClosePreview(); return; }
        if (data.type === 'swcreator:preview-output') event(String(data.text), !!pending, 'output', {stream: data.stream, buildId: preview.swCreatorBuildId});
    });

    module.swCreatorPreview = async function (result) {
        const artifact = result.artifacts.find(file => file.path.endsWith('.wasm'));
        if (!artifact) throw new Error('No browser application was produced.');
        const container = document.getElementById('swcreator-preview') || document.body;
        module.swCreatorClosePreview();
        const sideModule = result.profile === 'emscripten-side';
        const core = sideModule && result.projectProfile === 'core';
        const gui = sideModule && !core;
        container.classList.toggle('swcreator-gui-preview', gui);
        // Keep a host-owned close control available even while the runtime is
        // loading or the application's own window has no caption buttons.
        container.classList.toggle('swcreator-window-preview', gui);
        if (gui) {
            const element = module.canvas?.closest('[role="application"]');
            if (element) {
                previewWorkbench = {element, inert:element.inert, focus:document.activeElement};
                element.inert = true;
            }
        }
        preview = document.createElement('iframe');
        preview.title = core ? 'Core application runtime' : 'Application preview';
        preview.className = 'swcreator-preview-frame';
        preview.swCreatorBuildId = result.buildId;
        // Program execution occurs in a dedicated runtime; console programs use a stoppable worker.
        const previewUrl = new URL(sideModule ? '../runtime/index.html' : 'runner.html', scriptBase);
        const runtimeVersion = window.softiDeployment?.assets['runtime/index.html'];
        if (sideModule && runtimeVersion) previewUrl.searchParams.set('v', runtimeVersion);
        preview.src = previewUrl.href;
        container.hidden = false;
        const frame = preview;
        const loaded = new Promise((resolve, reject) => {
            const clear = () => {
                clearTimeout(timeout);
                frame.removeEventListener('load', onLoad);
                frame.removeEventListener('error', onError);
                cancelPreviewWait = null;
            };
            const onLoad = () => {
                // Keyboard events do not cross iframe boundaries. Capture in
                // the runtime too, before a main window consumes Escape.
                frame.contentWindow.addEventListener('keydown', closePreviewOnEscape, true);
                clear();
                resolve(true);
            };
            const onError = () => { clear(); reject(new Error('Unable to load the preview.')); };
            const timeout = setTimeout(() => { clear(); reject(new Error('The preview did not load.')); }, 30000);
            cancelPreviewWait = () => { clear(); resolve(false); };
            frame.addEventListener('load', onLoad);
            frame.addEventListener('error', onError);
        });
        container.appendChild(frame);
        let ready;
        try { ready = await loaded; }
        catch (error) { if (frame === preview) module.swCreatorClosePreview(); throw error; }
        if (!ready || frame !== preview) return;
        if (gui) frame.focus();
        const bytes = new Uint8Array(artifact.bytes);
        const id = ++sequence;
        let started;
        if (sideModule) {
            started = new Promise((resolve, reject) => {
                const clear = () => {
                    clearTimeout(timeout);
                    window.removeEventListener('message', listener);
                    cancelPreviewWait = null;
                };
                const listener = ({source, origin, data}) => {
                    if (source !== frame.contentWindow || origin !== location.origin || !data || data.type !== 'swcreator:preview-result' || data.id !== id) return;
                    clear();
                    if (data.ok) {
                        // Once the application's own frame is ready, its cross
                        // owns closing. Keep the host button as a loading fallback.
                        container.classList.toggle('swcreator-window-preview', gui &&
                            !frame.contentDocument?.querySelector('[data-swstack-frame]'));
                        resolve();
                    }
                    else reject(new Error(data.error || 'Unable to start the application.'));
                };
                const timeout = setTimeout(() => {
                    clear();
                    reject(new Error('The application did not start.'));
                }, 60000);
                cancelPreviewWait = () => { clear(); resolve(); };
                window.addEventListener('message', listener);
            });
        }
        frame.contentWindow.postMessage({type: 'swcreator:run', id, wasm: bytes.buffer, formSize:result.formSize,
            projectProfile: result.projectProfile,
            name: artifact.path, wasiShim: new URL('toolchain/wasi-shim/index.js', scriptBase).href},
            location.origin, [bytes.buffer]);
        if (started) {
            try { await started; }
            catch (error) { if (frame === preview) module.swCreatorClosePreview(); throw error; }
        }
    };

    module.swCreatorCompile = async function (request) {
        if (pending) throw new Error('A compilation is already running.');
        // The worker and installer already accept raw byte buffers. Decode
        // snapshot resources here so their bytes survive compilation/packaging.
        if (request.files?.some(file => file.encoding === 'base64')) request = {...request,
            files:request.files.map(file => file.encoding === 'base64'
                ? {path:file.path, bytes:Uint8Array.from(atob(file.content), char => char.charCodeAt(0))} : file)};
        event('Starting compilation…', true, 'start', {buildId: request.buildId});
        const result = await new Promise((resolve, reject) => {
            const id = ++sequence;
            pending = {id, resolve, reject, buildId: request.buildId};
            try { compilerWorker().postMessage({type: 'compile', id, request}); }
            catch (error) { pending = null; error.buildId = request.buildId; reject(reportError(error)); }
        });
        result.buildId = request.buildId;
        try {
            if ((request.target === 'windows' || request.target === 'linux') && request.download !== false) {
                for (const artifact of result.artifacts) module.swCreatorDownload(artifact.path, artifact.bytes, artifact.mime);
            } else if (request.target === 'web' && request.preview !== false) {
                await module.swCreatorPreview(result);
            }
        } catch (error) { error.buildId = request.buildId; throw reportError(error); }
        return result;
    };
    module.swCreatorCompilerReady = true;
})();
