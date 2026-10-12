/* Softi owns the installation prompt; SwStack owns extension detection and HTTP. */
(function () {
    'use strict';
    const module = window.Module || (window.Module = {});
    const declined = new Set();
    const permissionDeclined = new Set();
    let checking = false;
    let currentDialog = null;
    const assets = new URL('assets/web-proxy/', document.currentScript.src);
    const dialogContents = `<style>
            #network-bridge-install { --bg:#111317; --ink:#f4f5f7; --text:#e0e3e8; --muted:#a5acb8; --panel:#1b1e24; --line:#363c47; --on-ink:#111317; color-scheme:dark; box-sizing:border-box; width:min(560px, calc(100vw - 32px)); max-height:calc(100dvh - 32px); overflow:auto; padding:28px; border:1px solid var(--line); border-radius:16px; background:var(--bg); color:var(--text); box-shadow:0 24px 80px #0006; font:14px/1.55 "Segoe UI",system-ui,sans-serif; text-align:left; }
            #network-bridge-install *, #network-bridge-install *::before { box-sizing:border-box; }
            #network-bridge-install [hidden] { display:none !important; }
            #network-bridge-install::backdrop { background:#07080a99; }
            #network-bridge-install.light { --bg:#fff; --ink:#15171c; --text:#252a32; --muted:#5e6470; --panel:#f3f4f6; --line:#d5d9de; --on-ink:#fff; color-scheme:light; }
            #network-bridge-install .network-brand { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
            #network-bridge-install .network-logo { width:103px; height:34px; object-fit:contain; }
            #network-bridge-install .network-logo-light, #network-bridge-install.light .network-logo-dark { display:none; }
            #network-bridge-install.light .network-logo-light { display:block; }
            #network-bridge-install .network-heading { display:flex; align-items:center; gap:14px; }
            #network-bridge-install .network-proxy-icon { width:48px; height:48px; flex-shrink:0; }
            #network-bridge-install h2 { margin:0; font-size:27px; line-height:1.2; font-weight:600; letter-spacing:-.025em; color:var(--ink); }
            #network-bridge-install .network-subtitle { margin:4px 0 0; color:var(--muted); font-size:13px; }
            #network-bridge-install p { margin:14px 0; overflow-wrap:anywhere; }
            #network-bridge-install .network-target { display:flex; flex-wrap:wrap; gap:4px 12px; padding:12px 14px; border:1px solid var(--line); border-radius:8px; }
            #network-bridge-install .network-target-label { color:var(--muted); font-size:12px; }
            #network-bridge-install .network-server { margin:0; font:13px/1.5 Consolas,monospace; color:var(--ink); overflow-wrap:anywhere; min-width:0; }
            #network-bridge-install #network-bridge-explanation, #network-bridge-install #network-bridge-instructions { font-size:13px; color:var(--muted); }
            #network-bridge-install .network-guide { background:var(--panel); border-radius:10px; padding:16px; margin-top:18px; }
            #network-bridge-install .network-browser-row { display:flex; align-items:center; flex-wrap:wrap; gap:10px; }
            #network-bridge-install .network-browser-label { flex:1; min-width:150px; font-size:12px; color:var(--muted); }
            #network-bridge-install select { display:block; width:100%; margin-top:4px; padding:8px 10px; min-height:40px; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--ink); font:inherit; }
            #network-bridge-install .network-steps { counter-reset:step; list-style:none; display:grid; gap:10px; padding:0; margin:16px 0 0; font-size:13px; }
            #network-bridge-install .network-steps li { counter-increment:step; position:relative; padding-left:27px; }
            #network-bridge-install .network-steps li::before { content:counter(step,decimal-leading-zero); position:absolute; left:0; color:var(--muted); font:11px/1.9 Consolas,monospace; }
            #network-bridge-install .network-address { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-top:14px; padding-top:12px; border-top:1px solid var(--line); }
            #network-bridge-install code { font:12px/1.6 Consolas,monospace; user-select:all; overflow-wrap:anywhere; }
            #network-bridge-install .network-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; margin-top:18px; }
            #network-bridge-install button { font:inherit; font-size:13px; font-weight:600; min-height:40px; border:1px solid var(--line); border-radius:7px; padding:8px 12px; background:var(--bg); color:var(--ink); cursor:pointer; }
            #network-bridge-install button:hover { background:var(--panel); }
            #network-bridge-install #network-bridge-download, #network-bridge-install #network-bridge-authorize { background:var(--ink); border-color:var(--ink); color:var(--on-ink); }
            #network-bridge-install #network-bridge-download:hover, #network-bridge-install #network-bridge-authorize:hover { background:#2f6bff; border-color:#2f6bff; color:#fff; }
            #network-bridge-install #network-bridge-dismiss { display:grid; place-items:center; flex-shrink:0; padding:0; height:40px; width:40px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--muted); }
            #network-bridge-install #network-bridge-dismiss:hover { color:var(--ink); border-color:var(--muted); }
            #network-bridge-install #network-bridge-dismiss svg { display:block; width:18px; height:18px; pointer-events:none; }
            #network-bridge-install #network-bridge-copy { border:0; padding:0; min-height:24px; background:transparent; font-weight:400; text-decoration:underline; text-underline-offset:3px; }
            #network-bridge-install button:disabled { opacity:.5; cursor:default; }
            #network-bridge-install button:focus-visible, #network-bridge-install select:focus-visible { outline:3px solid #6696ff; outline-offset:3px; }
            #network-bridge-install #network-bridge-status { margin:14px 0 0; font-size:13px; color:var(--muted); }
            #network-bridge-install #network-bridge-status:empty { display:none; }
            #network-bridge-install #network-bridge-status[data-error] { color:#ff9a9a; }
            #network-bridge-install.light #network-bridge-status[data-error] { color:#b42338; }
            #network-bridge-install .network-footer { border-top:1px solid var(--line); padding-top:12px; margin:18px 0 0; font:10px/1.5 Consolas,monospace; letter-spacing:.02em; color:var(--muted); }
            @media(max-width:420px) { #network-bridge-install { padding:20px; } #network-bridge-install .network-browser-row { flex-direction:column; align-items:stretch; } #network-bridge-install .network-browser-label { min-width:0; } #network-bridge-install .network-actions button { flex:1; } }
        </style><header class="network-brand">
            <img class="network-logo network-logo-light" src="${assets}ariya-black.svg" alt="Ariya Consulting">
            <img class="network-logo network-logo-dark" src="${assets}ariya-white.svg" alt="Ariya Consulting">
            <button id="network-bridge-dismiss" type="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
            <div class="network-heading"><img class="network-proxy-icon" src="${assets}proxy.svg" alt="Web Proxy">
                <div><h2 id="network-bridge-title">Web Proxy</h2><p class="network-subtitle"></p></div></div>
            <p id="network-bridge-description"></p>
            <div class="network-target"><span class="network-target-label"></span><p class="network-server"></p></div>
            <p id="network-bridge-explanation"></p>
            <section class="network-guide"><div class="network-browser-row">
                <label class="network-browser-label"><span></span><select id="network-bridge-browser">
                    <option value="chrome">Google Chrome</option><option value="edge">Microsoft Edge</option><option value="firefox">Mozilla Firefox</option>
                </select></label><button id="network-bridge-download" type="button"></button></div>
                <ol class="network-steps"><li></li><li></li><li></li></ol>
                <div class="network-address"><code></code><button id="network-bridge-copy" type="button"></button></div>
            </section><p id="network-bridge-instructions"></p>
            <p id="network-bridge-status" role="status" aria-live="polite"></p>
            <div class="network-actions"><button id="network-bridge-cancel" type="button"></button>
            <button id="network-bridge-check" type="button"></button></div>
            <p class="network-footer">ARIYA CONSULTING · WEB PROXY</p>`;

    function serverOrigin(url) {
        try {
            const target = new URL(url);
            if (!['http:', 'https:'].includes(target.protocol) || target.origin === window.location.origin) return null;
            // Display only the server, never repository paths, query tokens or credentials.
            return target.origin;
        } catch (_) { return null; }
    }

    function createDialog(dark, origin, declinedServers, tr, onClose = () => {}) {
        const dialog = document.createElement('dialog');
        currentDialog = dialog;
        dialog.id = 'network-bridge-install';
        dialog.classList.toggle('light', !dark);
        dialog.setAttribute('aria-labelledby', 'network-bridge-title');
        dialog.setAttribute('aria-describedby', 'network-bridge-description');
        dialog.innerHTML = dialogContents;
        const find = id => dialog.querySelector('#' + id);
        const prompt = {
            dialog, find, closed: false,
            setStatus(text, error = false) {
                find('network-bridge-status').textContent = text;
                find('network-bridge-status').toggleAttribute('data-error', error);
            },
            close() { if (!prompt.closed) dialog.close(); },
            show() {
                document.body.appendChild(dialog);
                dialog.showModal();
                return true;
            }
        };
        const decline = () => declinedServers.add(origin);
        const dismiss = () => { decline(); prompt.close(); };
        dialog.addEventListener('close', () => {
            prompt.closed = true;
            onClose();
            currentDialog = null;
            dialog.remove();
            module.canvas?.focus();
        });
        dialog.addEventListener('cancel', decline);
        find('network-bridge-cancel').onclick = dismiss;
        find('network-bridge-dismiss').onclick = dismiss;
        find('network-bridge-dismiss').setAttribute('aria-label', tr('Fermer', 'Close'));
        find('network-bridge-dismiss').title = tr('Fermer', 'Close');
        dialog.querySelector('.network-target-label').textContent = tr('Serveur demandé', 'Requested server');
        dialog.querySelector('.network-server').textContent = origin;
        return prompt;
    }

    module.swCreatorNetworkBridgeRequired = async function ({url, english = false, dark = true} = {}) {
        const bridge = module.swNetworkBrowserBridge;
        const origin = serverOrigin(url);
        if (!bridge || !origin || checking || currentDialog || declined.has(origin)) return false;
        checking = true;
        try {
            const status = await bridge.probe(origin);
            // An installed extension may still need authorization or an update.
            // Neither condition is an invitation to install another copy.
            if (!status || status.available !== false) return false;
        } catch (_) { return false; }
        finally { checking = false; }

        const tr = (fr, en) => english ? en : fr;
        const prompt = createDialog(dark, origin, declined, tr);
        const {find, setStatus, close} = prompt;
        prompt.dialog.querySelector('.network-subtitle').textContent = tr('Connecter Softi à vos services', 'Connect Softi to your services');
        find('network-bridge-description').textContent = tr(
            'Softi n’arrive pas à joindre ce serveur depuis le navigateur. Web Proxy peut relayer cette connexion.',
            'Softi cannot reach this server from the browser. Web Proxy can relay this connection.');
        find('network-bridge-explanation').textContent = tr(
            'Une restriction du navigateur (CORS) peut expliquer cet échec. Web Proxy vous laisse choisir les serveurs accessibles à Softi. L’extension n’a pas été détectée : si vous l’avez déjà installée, vérifiez qu’elle est activée sur cette page.',
            'A browser restriction (CORS) may explain this failure. Web Proxy lets you choose which servers Softi can reach. The extension was not detected: if already installed, check that it is enabled on this page.');
        const mobile = navigator.userAgentData?.mobile || /Android|Mobile|Tablet|iPhone|iPad|iPod/.test(navigator.userAgent);
        const firefox = !mobile && /Firefox\//.test(navigator.userAgent);
        const chromium = !mobile && /(?:Chrome|Chromium)\//.test(navigator.userAgent);
        const supported = firefox || chromium;
        const selector = find('network-bridge-browser');
        selector.value = firefox ? 'firefox' : /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
        prompt.dialog.querySelector('.network-browser-label span').textContent = tr('Votre navigateur', 'Your browser');
        const steps = prompt.dialog.querySelectorAll('.network-steps li');
        steps[0].textContent = tr('Téléchargez Web Proxy et décompressez le fichier ZIP.', 'Download Web Proxy and extract the ZIP file.');
        steps[2].textContent = tr('Enregistrez vos modifications, puis rechargez Softi. Relancez ensuite votre opération.', 'Save your changes, then reload Softi. Retry your operation afterwards.');
        const address = prompt.dialog.querySelector('.network-address code');
        const updateBrowser = () => {
            const isFirefox = selector.value === 'firefox';
            address.textContent = isFirefox ? 'about:debugging#/runtime/this-firefox' : selector.value === 'edge' ? 'edge://extensions' : 'chrome://extensions';
            steps[1].textContent = isFirefox
                ? tr('Ouvrez cette adresse. Cliquez sur « Charger un module complémentaire temporaire » et choisissez manifest.json dans le dossier décompressé.', 'Open this address. Click “Load Temporary Add-on” and select manifest.json in the extracted folder.')
                : tr('Ouvrez cette adresse, activez le mode développeur, puis cliquez sur « Charger l’extension non empaquetée » et choisissez le dossier décompressé.', 'Open this address, enable developer mode, click “Load unpacked” and select the extracted folder.');
            find('network-bridge-instructions').textContent = isFirefox
                ? tr('Firefox : cette installation temporaire doit être renouvelée après un redémarrage du navigateur.', 'Firefox: this temporary installation must be repeated after restarting the browser.') : '';
        };
        selector.onchange = updateBrowser;
        updateBrowser();
        prompt.dialog.querySelector('.network-guide').hidden = !supported;
        if (!supported) find('network-bridge-instructions').textContent = tr(
            'Web Proxy est disponible pour Chrome, Edge et Firefox sur ordinateur. Ouvrez Softi dans l’un de ces navigateurs pour l’installer.',
            'Web Proxy is available for Chrome, Edge and Firefox on desktop. Open Softi in one of these browsers to install it.');
        find('network-bridge-copy').textContent = tr('Copier l’adresse', 'Copy address');
        find('network-bridge-copy').onclick = async () => {
            try {
                await navigator.clipboard.writeText(address.textContent);
                setStatus(tr('Adresse copiée. Collez-la dans un nouvel onglet.', 'Address copied. Paste it into a new tab.'));
            } catch (_) {
                setStatus(tr('Sélectionnez l’adresse ci-dessus et copiez-la dans un nouvel onglet.', 'Select the address above and copy it into a new tab.'));
            }
        };
        find('network-bridge-cancel').textContent = tr('Plus tard', 'Later');
        find('network-bridge-check').textContent = tr('Vérifier l’installation', 'Check installation');
        find('network-bridge-download').textContent = tr('Télécharger Web Proxy', 'Download Web Proxy');
        find('network-bridge-download').hidden = !supported;
        let probing = false;
        const probe = async () => {
            if (prompt.closed || probing) return null;
            probing = true;
            find('network-bridge-check').disabled = true;
            find('network-bridge-download').disabled = true;
            try {
                const status = await bridge.probe(origin);
                if (prompt.closed) return null;
                if (status?.available === true) { close(); return status; }
                if (!status || status.available !== false) throw new Error();
                return status;
            } catch (_) {
                if (!prompt.closed) setStatus(tr('Impossible de vérifier l’installation. Réessayez.', 'Unable to check installation. Try again.'), true);
                return null;
            } finally {
                probing = false;
                if (!prompt.closed) {
                    find('network-bridge-check').disabled = false;
                    find('network-bridge-download').disabled = false;
                }
            }
        };
        find('network-bridge-check').onclick = async () => {
            if ((await probe())?.available === false && !prompt.closed)
                setStatus(tr('Extension non détectée. Vérifiez son activation et son autorisation sur cette page, ou installez-la.',
                    'Extension not detected. Check that it is enabled and allowed on this page, or install it.'));
        };
        find('network-bridge-download').onclick = async () => {
            if (!supported) return;
            // Installation can finish while this dialog is open. Check again so
            // a stale prompt never downloads an already installed extension.
            if ((await probe())?.available !== false || prompt.closed) return;
            try {
                await bridge.download(selector.value === 'firefox' ? 'firefox' : 'chromium');
                if (!prompt.closed) setStatus(tr('Téléchargement lancé. Installez l’extension, enregistrez vos modifications, puis rechargez la page Softi pour l’activer. Relancez ensuite votre opération.',
                    'Download started. Install the extension, save your changes, then reload the Softi page to activate it. Retry your operation afterwards.'));
            } catch (error) {
                if (!prompt.closed) setStatus(tr('Téléchargement impossible. Réessayez.', 'Download failed. Try again.'), true);
            }
        };
        return prompt.show();
    };

    module.swCreatorNetworkBridgePermissionRequired = async function ({url, english = false, dark = true} = {}) {
        const bridge = module.swNetworkBrowserBridge;
        const origin = serverOrigin(url);
        if (!bridge || !origin || checking || currentDialog || permissionDeclined.has(origin)) return false;
        checking = true;
        try {
            const status = await bridge.probe(origin);
            if (!status?.available || !status.compatible || status.authorized) return false;
        } catch (_) { return false; }
        finally { checking = false; }

        const tr = (fr, en) => english ? en : fr;
        const permissionAbort = new AbortController();
        const prompt = createDialog(dark, origin, permissionDeclined, tr, () => permissionAbort.abort());
        prompt.dialog.dataset.kind = 'permission';
        const {find, setStatus, close} = prompt;
        const authorize = find('network-bridge-download');
        authorize.id = 'network-bridge-authorize';
        prompt.dialog.querySelector('.network-actions').append(authorize);
        prompt.dialog.querySelector('.network-browser-row').hidden = true;
        prompt.dialog.querySelector('.network-address').hidden = true;
        authorize.textContent = tr('Autoriser ce serveur', 'Authorize this server');
        prompt.dialog.querySelector('.network-subtitle').textContent = tr('Autoriser une connexion', 'Allow a connection');
        find('network-bridge-description').textContent = tr(
            'Web Proxy est installé. Autorisez ce serveur pour que Softi puisse s’y connecter.',
            'Web Proxy is installed. Allow this server so Softi can connect to it.');
        find('network-bridge-explanation').textContent = tr(
            'L’autorisation concerne uniquement cette page Softi et ce serveur. Vous gardez le contrôle des connexions.',
            'Permission applies only to this Softi page and this server. You stay in control of connections.');
        const steps = prompt.dialog.querySelectorAll('.network-steps li');
        steps[0].textContent = tr('Cliquez sur « Autoriser ce serveur ».', 'Click “Authorize this server”.');
        steps[1].textContent = tr('Un onglet Web Proxy s’ouvre. Vérifiez les adresses, puis confirmez l’autorisation.', 'A Web Proxy tab opens. Check the addresses, then confirm permission.');
        steps[2].textContent = tr('Revenez dans Softi et relancez votre opération.', 'Return to Softi and retry your operation.');
        find('network-bridge-instructions').textContent = tr(
            'Votre opération ne sera pas relancée automatiquement. Réessayez dans Softi après avoir autorisé l’accès.',
            'Your operation will not be retried automatically. Try again in Softi after granting access.');
        find('network-bridge-check').textContent = tr('Vérifier l’autorisation', 'Check authorization');
        find('network-bridge-cancel').textContent = tr('Plus tard', 'Later');
        let busy = false;
        const verify = async (requestPermission) => {
            if (prompt.closed || busy) return;
            busy = true;
            authorize.disabled = true;
            find('network-bridge-check').disabled = true;
            try {
                let status = await bridge.probe(origin);
                if (prompt.closed) return;
                if (!status?.available || !status.compatible) {
                    setStatus(tr('L’extension n’est plus disponible. Vérifiez son installation, puis réessayez dans Softi.',
                        'The extension is no longer available. Check its installation, then try again in Softi.'), true);
                    return;
                }
                if (status.authorized) { close(); return; }
                if (requestPermission) {
                    setStatus(tr('Confirmez l’autorisation dans l’onglet de l’extension, puis vérifiez l’autorisation ici.',
                        'Confirm access in the extension tab, then check authorization here.'));
                    await bridge.requestPermission(origin, 'Softi', permissionAbort.signal);
                    if (prompt.closed) return;
                    status = await bridge.probe(origin);
                    if (prompt.closed) return;
                    if (status?.available && status.authorized) { close(); return; }
                } else {
                    setStatus(tr('Ce serveur n’est pas encore autorisé.', 'This server is not authorized yet.'));
                }
            } catch (_) {
                if (!prompt.closed) setStatus(tr('Autorisation non accordée. Vous pouvez réessayer ou fermer ce dialogue.',
                    'Permission was not granted. You can try again or close this dialog.'), true);
            } finally {
                busy = false;
                if (!prompt.closed) {
                    authorize.disabled = false;
                    find('network-bridge-check').disabled = false;
                }
            }
        };
        authorize.onclick = () => verify(true);
        find('network-bridge-check').onclick = () => verify(false);
        return prompt.show();
    };
})();
