const output = document.getElementById('output');
const status = document.getElementById('status');
const stop = document.getElementById('stop');
let worker;
function halt() {
    worker?.terminate();
    worker = null;
    stop.disabled = true;
}
stop.onclick = () => { halt(); status.textContent = 'Stopped'; };
window.addEventListener('message', ({source, origin, data}) => {
    if (source !== parent || origin !== location.origin || data.type !== 'swcreator:run') return;
    halt();
    output.textContent = '';
    status.textContent = `Running ${data.name || 'application'}…`;
    stop.disabled = false;
    worker = new Worker(new URL('run-worker.mjs', import.meta.url), {type: 'module'});
    worker.onmessage = ({data: event}) => {
        if (event.type === 'output') {
            output.textContent = (output.textContent + event.text).slice(-1024 * 1024);
        } else {
            status.textContent = event.type === 'error' ? event.text : `Exited with code ${event.exitCode}`;
            halt();
        }
    };
    worker.onerror = event => { status.textContent = event.message; halt(); };
    worker.postMessage(data, [data.wasm]);
});
