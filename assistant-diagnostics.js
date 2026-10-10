const run=document.getElementById('run'),copy=document.getElementById('copy');
const status=document.getElementById('status'),output=document.getElementById('report');
let report;
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function publish(value){report=value;output.textContent=JSON.stringify(value,null,2);output.hidden=false;copy.disabled=false;}
function errorCode(value){
    const message=value?.error?.message || '';
    if(message.includes('anthropic-dangerous-direct-browser-access'))return 'browser_header_required';
    if(/invalid.*(bearer|token|credential)|expired|revoked/i.test(message))return 'invalid_or_expired_session';
    if(/permission|scope|not allowed|not authorized|forbidden/i.test(message))return 'permission_denied';
    const type=value?.error?.type;
    return ['authentication_error','permission_error','rate_limit_error','api_error','invalid_request_error'].includes(type)?type:'http_error';
}
run.onclick=async()=>{
    // Open during the user gesture; a delayed window.open is blocked by browsers.
    const app=window.open('about:blank','softi-account-diagnostic');
    if(!app){status.textContent='Autorisez l’ouverture de l’onglet Softi, puis réessayez.';return;}
    run.disabled=true;copy.disabled=true;status.textContent='Vérification en cours…';
    const result={page:location.origin+location.pathname,browser:navigator.userAgent,providers:{}};
    try{
        const response=await fetch('assistant-diagnostics.json?check='+Date.now(),{cache:'no-store'});
        if(!response.ok)throw new Error('La configuration du diagnostic est indisponible.');
        const config=await response.json();
        const address=new URL(config.document,location.href);address.searchParams.set('release',config.release);
        result.application=config.application;result.applicationPage=address.origin+address.pathname;
        document.getElementById('open').href=address.href;app.location=address.href;
        const deadline=Date.now()+60000;
        while(!app.closed && !app.Module?.swCreatorReady && Date.now()<deadline)await wait(100);
        if(app.closed)throw new Error('L’onglet Softi a été fermé.');
        if(!app.Module?.swCreatorReady)throw new Error('Softi n’a pas terminé son chargement.');
        result.publishedRelease=config.release;
        result.loadedRelease=app.softiDeployment?.release || null;
        result.applicationCurrent=result.loadedRelease===config.release;
        const browser=app.Module.iaBrowser;
        if(!browser || !app.softiExtensionInfo)throw new Error('Une ancienne version de Softi est encore chargée.');
        result.extension=await app.softiExtensionInfo();
        for(const provider of ['chatgpt','claude']){
            const row=result.providers[provider]={};
            try{
                const account=await browser.request(config.application,provider,'status');
                row.paired=account.paired!==false;row.authenticated=account.authenticated===true;
                if(!row.authenticated)continue;
                const endpoint=provider==='claude'?'https://api.anthropic.com/v1/models':'https://api.openai.com/v1/models';
                const response=await browser.fetch(account.credential,endpoint);
                row.httpStatus=response.status;
                let body;
                try{body=await response.json();}catch(_){row.errorCode='non_json_response';continue;}
                if(!response.ok)row.errorCode=errorCode(body);
                else row.modelCount=(body.data || body.models || []).length;
            }catch(error){row.error=String(error.message || 'Connexion indisponible').slice(0,512);}
        }
        status.textContent='Vérification terminée. Copiez le diagnostic pour examiner le blocage.';
    }catch(error){result.error=String(error.message || 'Vérification indisponible').slice(0,512);status.textContent='La vérification a rencontré un blocage.';}
    finally{publish(result);run.disabled=false;window.focus();}
};
copy.onclick=async()=>{
    try{await navigator.clipboard.writeText(JSON.stringify(report,null,2));status.textContent='Diagnostic copié.';}
    catch(_){const selection=window.getSelection();const range=document.createRange();range.selectNodeContents(output);selection.removeAllRanges();selection.addRange(range);status.textContent='Le diagnostic est sélectionné. Copiez-le avec Ctrl+C.';}
};
