// Application presentation only. Transport/navigation are supplied by SwStack Network.
(function () {
    let current;
    function dialog(title, text, action, label) {
        if (current) return;
        const host = document.createElement('div'), root = host.attachShadow({mode: 'closed'});
        root.innerHTML = '<style>:host{position:fixed;inset:0;z-index:2147483647;font:15px system-ui;color:#202124}' +
            '.backdrop{position:absolute;inset:0;background:#0006;display:grid;place-items:center}.card{background:white;border-radius:16px;padding:28px;max-width:480px;margin:24px;box-shadow:0 16px 60px #0005}' +
            'h2{margin:0 0 16px;font-size:22px}p{line-height:1.5;overflow-wrap:anywhere}button{padding:10px 16px;margin:12px 8px 0 0;border:1px solid #ccc;border-radius:8px;background:#fff;cursor:pointer}.primary{background:#202124;color:#fff}</style>' +
            '<div class="backdrop"><div class="card" role="dialog" aria-modal="true" aria-labelledby="title"><h2 id="title"></h2><p></p><p class="status" role="status"></p><button class="primary"></button><button class="close">Fermer</button></div></div>';
        root.querySelector('h2').textContent = title; root.querySelector('p').textContent = text;
        const button = root.querySelector('.primary'), status = root.querySelector('.status');
        button.textContent = label;
        const close = () => {host.remove();current = null;};
        root.querySelector('.close').onclick = close;
        button.onclick = async () => {
            button.disabled = true;
            try {status.textContent = await action();} catch (error) {status.textContent = error?.message || 'L’opération a échoué.';}
            finally {button.disabled = false;}
        };
        current = host; document.body.append(host); button.focus();
    }
    Module['iaNetworkUi'] = {
        showInstaller() {
            dialog('Connexion au navigateur', 'Installez SwStack Network pour autoriser les connexions de cette application. Décompressez le fichier téléchargé, puis chargez son dossier dans la page des extensions de votre navigateur. Rechargez ensuite cette application.',
                () => {Module['swNetworkBrowserBridge'].download();return 'Le fichier a été téléchargé. Après installation, rechargez cette page.';}, 'Télécharger l’extension');
        },
        showPermission(origin) {
            dialog('Autoriser la connexion', 'Cette application souhaite contacter ' + origin + '. Vérifiez l’adresse dans la page d’autorisation qui va s’ouvrir.', async () => {
                await Module['swNetworkBrowserBridge'].requestPermission(origin, Module['swNetworkBrowserApplication']);
                return 'Connexion autorisée. Vous pouvez fermer cette fenêtre et relancer votre action.';
            }, 'Vérifier et autoriser');
        }
    };
})();
