const run=document.getElementById('run'),copy=document.getElementById('copy');
const status=document.getElementById('status'),output=document.getElementById('report');
let report;
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));
function publish(value){report=value;output.textContent=JSON.stringify(value,null,2);output.hidden=false;copy.disabled=false;}
function errorCode(value){
    const message=value?.error?.message || '';
    if(/CORS requests are not allowed for this Organization/i.test(message))return 'organization_browser_access_denied';
    if(message.includes('anthropic-dangerous-direct-browser-access'))return 'browser_header_required';
    if(/invalid.*(bearer|token|credential)|expired|revoked/i.test(message))return 'invalid_or_expired_session';
    if(/permission|scope|not allowed|not authorized|forbidden/i.test(message))return 'permission_denied';
    const type=value?.error?.type;
    return ['authentication_error','permission_error','rate_limit_error','api_error','invalid_request_error'].includes(type)?type:'http_error';
}
async function readEndpoint(browser,credential,endpoint){
    const response=await browser.fetch(credential,endpoint);
    const text=await response.text();
    const result={httpStatus:response.status,responseBytes:new TextEncoder().encode(text).length};
    let body;
    try{body=JSON.parse(text);}catch(_){result.errorCode='non_json_response';return result;}
    if(!response.ok)result.errorCode=errorCode(body);
    else if(Array.isArray(body.data || body.models))result.modelCount=(body.data || body.models).length;
    return result;
}
run.onclick=async()=>{
    // Open during the user gesture; a delayed window.open is blocked by browsers.
    const app=window.open('about:blank','softi-account-diagnostic');
    if(!app){status.textContent='Autorisez l’ouverture de l’onglet Softi, puis réessayez.';return;}
    run.disabled=true;copy.disabled=true;status.textContent='Vérification en cours…';
    const result={diagnosticVersion:2,page:location.origin+location.pathname,browser:navigator.userAgent,providers:{}};
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
                Object.assign(row,await readEndpoint(browser,account.credential,endpoint));
                // The assistant uses a different catalogue operation from the raw HTTP probe.
                try{
                    const catalog=await browser.request(config.application,provider,'models',{binding:account.binding});
                    row.assistantModels={available:true,modelCount:catalog.models?.length || 0};
                }catch(error){row.assistantModels={available:false,error:String(error.message || 'Catalogue indisponible').slice(0,512)};}
                if(provider==='claude'){
                    // Claude's C++ agent validates the profile before requesting its models.
                    try{row.profile=await readEndpoint(browser,account.credential,'https://api.anthropic.com/api/oauth/profile');}
                    catch(error){row.profile={error:String(error.message || 'Profil indisponible').slice(0,512)};}
                }
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
