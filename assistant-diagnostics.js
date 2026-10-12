const run = document.getElementById('run'), copy = document.getElementById('copy');
const status = document.getElementById('status'), output = document.getElementById('report');
let report;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
function publish(value) {
    report = value; output.textContent = JSON.stringify(value, null, 2);
    output.hidden = false; copy.disabled = false;
}
run.onclick = async () => {
    const app = window.open('about:blank', 'swstack-network-diagnostic');
    if (!app) {status.textContent = 'Autorisez l’ouverture de l’onglet, puis réessayez.'; return;}
    run.disabled = true; copy.disabled = true; status.textContent = 'Vérification en cours…';
    const result = {diagnosticVersion: 4, page: location.origin + location.pathname};
    try {
        const response = await fetch('assistant-diagnostics.json?check=' + Date.now(), {cache: 'no-store'});
        if (!response.ok) throw new Error('La configuration du diagnostic est indisponible.');
        const config = await response.json(), address = new URL(config.document, location.href);
        address.searchParams.set('release', config.release);
        result.application = config.application; result.applicationPage = address.origin + address.pathname;
        document.getElementById('open').href = address.href; app.location = address.href;
        const deadline = Date.now() + 60000;
        while (!app.closed && !app.Module?.swNetworkBrowserBridge && Date.now() < deadline) await wait(100);
        if (app.closed) throw new Error('L’onglet de l’application a été fermé.');
        if (!app.Module?.swNetworkBrowserBridge) throw new Error('Le transport réseau n’est pas chargé. Recompilez l’application.');
        result.publishedRelease = config.release;
        result.loadedRelease = app.softiDeployment?.release || null;
        result.applicationCurrent = result.loadedRelease === config.release;
        result.extension = await app.Module.swNetworkBrowserBridge.probe(app.location.origin);
        result.browser = {secureContext: app.isSecureContext, indexedDB: !!app.indexedDB,
            webCrypto: !!app.crypto?.subtle, webLocks: !!app.navigator.locks};
        // Inspect transport capability only. Account state, token access and
        // provider endpoint requests belong to the C++ runtime.
        status.textContent = 'Vérification terminée. Le rapport décrit le transport et les fonctions du navigateur.';
    } catch (error) {
        result.error = String(error.message || 'Vérification indisponible').slice(0, 512);
        status.textContent = 'La vérification a rencontré un blocage.';
    } finally {publish(result); run.disabled = false; window.focus();}
};
copy.onclick = async () => {
    try {await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); status.textContent = 'Diagnostic copié.';}
    catch (_) {
        const selection = window.getSelection(), range = document.createRange();
        range.selectNodeContents(output); selection.removeAllRanges(); selection.addRange(range);
        status.textContent = 'Le diagnostic est sélectionné. Copiez-le avec Ctrl+C.';
    }
};
