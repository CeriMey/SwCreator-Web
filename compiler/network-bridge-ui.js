/* Softi owns the installation prompt; SwStack owns extension detection and HTTP. */
(function () {
    'use strict';
    const module = window.Module || (window.Module = {});
    const declined = new Set();
    const permissionDeclined = new Set();
    let checking = false;
    let currentDialog = null;
    const dialogContents = `<style>
            #network-bridge-install { box-sizing:border-box; width:min(520px, calc(100vw - 32px)); max-height:calc(100dvh - 32px); overflow:auto; padding:28px; border:1px solid #465064; border-radius:14px; background:#20242c; color:#e7edf7; box-shadow:0 18px 70px #0007; font:14px/1.6 system-ui,sans-serif; }
            #network-bridge-install::backdrop { background:#0007; }
            #network-bridge-install.light { color-scheme:light; background:#fff; color:#172033; border-color:#cbd3df; }
            #network-bridge-install h2 { margin:0 0 12px; font-size:20px; line-height:1.3; }
            #network-bridge-install p { margin:12px 0; }
            #network-bridge-install .network-server { font-family:ui-monospace,monospace; overflow-wrap:anywhere; }
            #network-bridge-install .network-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; margin-top:20px; }
            #network-bridge-install button { font:inherit; min-height:40px; border:1px solid #465064; border-radius:6px; padding:8px 12px; background:#303848; color:#e7edf7; cursor:pointer; }
            #network-bridge-install.light button { background:#f3f6fb; color:#172033; border-color:#cbd3df; }
            #network-bridge-install #network-bridge-download, #network-bridge-install #network-bridge-authorize { background:#2563eb; border-color:#2563eb; color:#fff; }
            #network-bridge-install button:disabled { opacity:.5; cursor:default; }
            #network-bridge-install button:focus-visible { outline:3px solid #8bb8ff; outline-offset:3px; }
            #network-bridge-status { min-height:24px; }
            #network-bridge-status[data-error] { color:#ed8796; }
            #network-bridge-install.light #network-bridge-status[data-error] { color:#b42338; }
        </style><h2 id="network-bridge-title"></h2>
            <p id="network-bridge-description"></p><p class="network-server"></p>
            <p id="network-bridge-explanation"></p><p id="network-bridge-instructions"></p>
            <p id="network-bridge-status" role="status" aria-live="polite"></p>
            <div class="network-actions"><button id="network-bridge-cancel" type="button"></button>
            <button id="network-bridge-check" type="button"></button>
            <button id="network-bridge-download" type="button"></button></div>`;

    function serverOrigin(url) {
        try {
            const target = new URL(url);
            if (!['http:', 'https:'].includes(target.protocol) || target.origin === window.location.origin) return null;
            // Display only the server, never repository paths, query tokens or credentials.
            return target.origin;
        } catch (_) { return null; }
    }

    function createDialog(dark, origin, declinedServers, onClose = () => {}) {
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
        dialog.addEventListener('close', () => {
            prompt.closed = true;
            onClose();
            currentDialog = null;
            dialog.remove();
            module.canvas?.focus();
        });
        dialog.addEventListener('cancel', decline);
        find('network-bridge-cancel').onclick = () => { decline(); prompt.close(); };
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
        const prompt = createDialog(dark, origin, declined);
        const {find, setStatus, close} = prompt;
        find('network-bridge-title').textContent = tr('Accès réseau du navigateur', 'Browser network access');
        find('network-bridge-description').textContent = tr(
            'La requête vers ce serveur n’a pas abouti. Une restriction CORS est possible, mais le navigateur ne permet pas de confirmer la cause.',
            'The request to this server failed. A CORS restriction is possible, but the browser cannot confirm the cause.');
        find('network-bridge-explanation').textContent = tr(
            'L’extension SwStack Network permet à Softi d’accéder aux serveurs que vous autorisez. Elle n’a pas été détectée. Si vous l’avez déjà installée, vérifiez qu’elle est activée et autorisée sur cette page avant de la télécharger à nouveau.',
            'The SwStack Network extension lets Softi access servers you authorize. It was not detected. If you already installed it, check that it is enabled and allowed on this page before downloading it again.');
        const mobile = /Android|Mobile|Tablet|iPhone|iPad|iPod/.test(navigator.userAgent);
        const firefox = !mobile && /Firefox\//.test(navigator.userAgent);
        const chromium = !mobile && /(?:Chrome|Chromium)\//.test(navigator.userAgent);
        const browser = firefox ? 'firefox' : chromium ? 'chromium' : null;
        find('network-bridge-instructions').textContent = !browser
            ? tr('L’extension est disponible pour Chrome, Edge et Firefox sur ordinateur. Ouvrez Softi dans l’un de ces navigateurs pour l’installer.',
                'The extension is available for Chrome, Edge and Firefox on desktop. Open Softi in one of these browsers to install it.')
            : firefox
            ? tr('Décompressez le téléchargement. Dans about:debugging, choisissez « Ce Firefox », puis « Charger un module complémentaire temporaire » et sélectionnez manifest.json.',
                'Extract the download. In about:debugging, choose “This Firefox”, then “Load Temporary Add-on” and select manifest.json.')
            : tr('Décompressez le téléchargement. Dans la page des extensions du navigateur, activez le mode développeur et chargez le dossier décompressé.',
                'Extract the download. On your browser’s extensions page, enable developer mode and load the extracted folder.');
        if (browser) find('network-bridge-instructions').textContent += tr(
            ' Enregistrez vos modifications, puis rechargez la page Softi après l’installation pour activer l’extension.',
            ' Save your changes, then reload the Softi page after installation to activate the extension.');
        find('network-bridge-cancel').textContent = tr('Plus tard', 'Later');
        find('network-bridge-check').textContent = tr('Vérifier l’installation', 'Check installation');
        find('network-bridge-download').textContent = tr('Télécharger l’extension', 'Download extension');
        find('network-bridge-download').hidden = !browser;
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
            if (!browser) return;
            // Installation can finish while this dialog is open. Check again so
            // a stale prompt never downloads an already installed extension.
            if ((await probe())?.available !== false || prompt.closed) return;
            try {
                await bridge.download(browser);
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
        const prompt = createDialog(dark, origin, permissionDeclined, () => permissionAbort.abort());
        prompt.dialog.dataset.kind = 'permission';
        const {find, setStatus, close} = prompt;
        const authorize = find('network-bridge-download');
        authorize.id = 'network-bridge-authorize';
        authorize.textContent = tr('Autoriser ce serveur', 'Authorize this server');
        find('network-bridge-title').textContent = tr('Autoriser l’accès réseau', 'Authorize network access');
        find('network-bridge-description').textContent = tr(
            'L’extension SwStack Network est installée. Softi a besoin de votre autorisation pour accéder à ce serveur.',
            'The SwStack Network extension is installed. Softi needs your permission to access this server.');
        find('network-bridge-explanation').textContent = tr(
            'L’extension vous demandera de confirmer cette autorisation dans son propre onglet.',
            'The extension will ask you to confirm this permission in its own tab.');
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
