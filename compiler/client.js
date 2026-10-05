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

    module.swCreatorChooseFiles = function () {
        if (module.swCreatorImportDecision) return false;
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
                const accepted = await new Promise(resolve => {
                    module.swCreatorImportDecision = resolve;
                    module.ccall('swcreator_web_prepare_import', null, ['string', 'string', 'number'], [file.name, text, snapshot ? 1 : 0]);
                });
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
        preview.src = sideModule
            ? new URL('../runtime/index.html', scriptBase).href
            : new URL('runner.html', scriptBase).href;
        container.hidden = false;
        const frame = preview;
        const loaded = new Promise((resolve, reject) => {
            const clear = () => {
                clearTimeout(timeout);
                frame.removeEventListener('load', onLoad);
                frame.removeEventListener('error', onError);
                cancelPreviewWait = null;
            };
            const onLoad = () => { clear(); resolve(true); };
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
                    if (data.ok) resolve();
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
        event('Starting compilation…', true, 'start', {buildId: request.buildId});
        const result = await new Promise((resolve, reject) => {
            const id = ++sequence;
            pending = {id, resolve, reject, buildId: request.buildId};
            try { compilerWorker().postMessage({type: 'compile', id, request}); }
            catch (error) { pending = null; error.buildId = request.buildId; reject(reportError(error)); }
        });
        result.buildId = request.buildId;
        try {
            if (request.target === 'windows' && request.download !== false) {
                for (const artifact of result.artifacts) module.swCreatorDownload(artifact.path, artifact.bytes, artifact.mime);
            } else if (request.target === 'web' && request.preview !== false) {
                await module.swCreatorPreview(result);
            }
        } catch (error) { error.buildId = request.buildId; throw reportError(error); }
        return result;
    };
    module.swCreatorCompilerReady = true;
})();
