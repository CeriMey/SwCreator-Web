// Application presentation only. SwStack supplies HTTP and browser navigation.
(function () {
    let current, checking = false;
    const assets = new URL('extensions/web-proxy/', document.baseURI);
    function applicationPrompt(permission, origin) {
        const offer = Module[permission ? 'swCreatorNetworkBridgePermissionRequired' : 'swCreatorNetworkBridgeRequired'];
        if (!origin || typeof offer !== 'function') return false;
        void offer({url: origin, ...Module['swCreatorNetworkBridgeAppearance']});
        return true;
    }
    function dialog(origin, permission) {
        if (current || !document.body) return;
        const host = document.createElement('dialog');
        host.setAttribute('aria-label', 'Web Proxy');
        host.style.cssText = 'width:min(540px,calc(100vw - 24px));max-height:calc(100dvh - 24px);padding:0;border:1px solid #707680;border-radius:12px;overflow:auto;box-shadow:0 20px 80px #0006';
        const holder = document.createElement('div'), root = holder.attachShadow({mode:'open'});
        root.innerHTML = `<link rel="stylesheet" href="${assets}installer.css">
            <section class="surface"><header class="header"><picture class="logo">
                <source media="(prefers-color-scheme:dark)" srcset="${assets}ariya-white.svg">
                <img src="${assets}ariya-black.svg" alt="Ariya Consulting" width="103" height="34">
            </picture><p class="eyebrow">Web Proxy</p><button class="dismiss" type="button" aria-label="Fermer">×</button></header>
            <div class="providers"><img src="${assets}proxy.svg" alt="Web Proxy" width="40" height="40"><h2 class="title">Web Proxy</h2></div>
            <p class="intro"></p><p class="version"></p><section class="guide"><div class="browser-row">
                <label class="browser-label" for="web-proxy-browser">Votre navigateur</label><select id="web-proxy-browser"><option value="chromium">Chrome / Edge</option><option value="firefox">Firefox</option></select>
                <button class="button download" type="button">Télécharger Web Proxy</button></div>
                <ol class="steps"></ol><div class="address-row"><code></code><button class="copy" type="button">Copier l’adresse</button></div>
            </section><p class="note" role="status" aria-live="polite"></p>
            <div class="actions"><button class="button reload" type="button"></button><button class="button later" type="button">Plus tard</button></div>
            <footer class="footer">ARIYA CONSULTING · WEB PROXY</footer></section>`;
        host.append(holder);
        const find = selector => root.querySelector(selector), controller = new AbortController();
        const close = () => {controller.abort();host.close();};
        host.addEventListener('close', () => {controller.abort();host.remove();current = null;Module['canvas']?.focus();});
        find('.dismiss').onclick = find('.later').onclick = close;
        find('.intro').textContent = permission
            ? 'Web Proxy est installé. Autorisez ce serveur pour que l’assistant puisse s’y connecter.'
            : 'Web Proxy relaie les connexions que le navigateur peut bloquer. Vous choisissez les serveurs accessibles à l’assistant.';
        find('.version').textContent = origin || '';
        const select = find('select'), steps = find('.steps'), address = find('code'), status = find('[role=status]');
        const action = find('.reload'), download = find('.download');
        const mobile = navigator.userAgentData?.mobile || /Android|Mobile|Tablet|iPhone|iPad|iPod/.test(navigator.userAgent);
        const supported = !mobile && /Chrome|Chromium|Edg\/|Firefox\//.test(navigator.userAgent);
        select.value = /Firefox\//.test(navigator.userAgent) ? 'firefox' : 'chromium';
        function instructions() {
            const firefox = select.value === 'firefox';
            address.textContent = firefox ? 'about:debugging#/runtime/this-firefox' : /Edg\//.test(navigator.userAgent) ? 'edge://extensions' : 'chrome://extensions';
            const texts = permission ? [
                'Cliquez sur « Autoriser ce serveur ».',
                'Dans l’onglet Web Proxy, vérifiez les adresses puis confirmez l’autorisation.',
                'Revenez dans l’assistant et relancez votre opération.'
            ] : [
                'Téléchargez Web Proxy et décompressez le fichier ZIP.',
                firefox ? 'Ouvrez cette adresse, choisissez « Charger un module complémentaire temporaire » puis manifest.json dans le dossier extrait.' : 'Ouvrez cette adresse, activez le mode développeur puis choisissez « Charger l’extension non empaquetée » et le dossier extrait.',
                'Enregistrez vos modifications, puis rechargez l’application. Relancez ensuite votre opération.'
            ];
            steps.replaceChildren(...texts.map(text => {const item=document.createElement('li');item.textContent=text;return item;}));
            if (!permission) status.textContent = firefox ? 'Firefox : l’installation temporaire doit être renouvelée après un redémarrage du navigateur.' : '';
        }
        select.onchange = instructions; instructions();
        find('.browser-row').hidden = permission || !supported;
        find('.address-row').hidden = permission || !supported;
        if (!permission && !supported) {steps.hidden=true;status.textContent='Web Proxy est disponible pour Chrome, Edge et Firefox sur ordinateur.';}
        find('.copy').onclick = async () => {
            try {await navigator.clipboard.writeText(address.textContent);status.textContent='Adresse copiée. Collez-la dans un nouvel onglet.';}
            catch (_) {status.textContent='Sélectionnez l’adresse ci-dessus et copiez-la dans un nouvel onglet.';}
        };
        download.onclick = async () => {
            download.disabled = true;
            try {
                const state = await Module['swNetworkBrowserBridge'].probe(origin);
                if (!host.open) return;
                if (state?.available !== false) {status.textContent='Web Proxy est déjà installé. Vous pouvez fermer cette fenêtre.';return;}
                await Module['swNetworkBrowserBridge'].download(select.value);
                status.textContent='Téléchargement lancé. Suivez les étapes ci-dessus, puis relancez votre opération.';
            } catch (_) {status.textContent='Téléchargement impossible. Réessayez.';}
            finally {download.disabled = false;}
        };
        action.textContent = permission ? 'Autoriser ce serveur' : 'Vérifier l’installation';
        action.onclick = async () => {
            action.disabled = true;
            try {
                const bridge = Module['swNetworkBrowserBridge'];
                let state = await bridge.probe(origin);
                if (!host.open) return;
                if (permission && state?.available && state.compatible && !state.authorized) {
                    status.textContent='Confirmez l’autorisation dans l’onglet Web Proxy.';
                    await bridge.requestPermission(origin, Module['swNetworkBrowserApplication'], controller.signal);
                    state = await bridge.probe(origin);
                }
                if (!host.open) return;
                if (state?.available && (!permission || state.authorized)) close();
                else status.textContent=permission ? 'Ce serveur n’est pas encore autorisé.' : 'Web Proxy n’est pas détecté. Vérifiez son activation et rechargez l’application après installation.';
            } catch (_) {if(host.open)status.textContent=permission ? 'Autorisation non accordée. Vous pouvez réessayer.' : 'Impossible de vérifier l’installation. Réessayez.';}
            finally {action.disabled = false;}
        };
        current = host;document.body.append(host);host.showModal();
    }
    async function show(origin, permission) {
        if (applicationPrompt(permission, origin) || current || checking) return;
        checking = true;
        try {
            const state = await Module['swNetworkBrowserBridge']?.probe(origin);
            if (permission ? state?.available && state.compatible && !state.authorized : state?.available === false) dialog(origin, permission);
        } catch (_) {} finally {checking = false;}
    }
    Module['iaNetworkUi'] = {showInstaller:origin => show(origin, false), showPermission:origin => show(origin, true)};
})();
