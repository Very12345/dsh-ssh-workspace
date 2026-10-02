 const STATUS_LABELS={idle:'未连接',connecting:'连接中',connected:'已连接',disconnected:'连接已断开',unknown:'状态未知'};
 const STATUS_STYLE='.dsh-ssh-folder-status-anchor{position:relative;overflow:visible!important}.dsh-ssh-connection-dot{position:absolute;right:-2px;top:1px;width:7px;height:7px;border-radius:50%;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1,#fff);background:#969eab;pointer-events:none}.dsh-ssh-connection-dot[data-state=connected]{background:#21936a}.dsh-ssh-connection-dot[data-state=connecting]{background:#c58c2e}.dsh-ssh-connection-dot[data-state=disconnected]{background:#d64d4d}';
 const normalizedPath=value=>{const path=String(value||'').replaceAll('\\','/').replace(/\/+$/,'');return /^[a-z]:\//i.test(path)?path.toLowerCase():path;};
 function ConnectionBadges({useWorkspaces}){
  const workspaces=useWorkspaces(state=>state.items),[status,setStatus]=R.useState({servers:[],workspaces:[]});
  R.useEffect(()=>{
   const abort=new AbortController();let timer;
   const update=async()=>{
    if(document.visibilityState==='hidden')return;
    try{const response=await fetch('/plugins/ssh-workspace/status',{signal:abort.signal});const data=await response.json();if(!response.ok||!data.ok)throw new Error('Status unavailable');if(!abort.signal.aborted)setStatus(data);}
    catch{if(!abort.signal.aborted)setStatus(value=>({...value,servers:value.servers.map(server=>({...server,state:'unknown'}))}));}
    finally{if(!abort.signal.aborted)timer=setTimeout(update,5000);}
   };
   const visibility=()=>{clearTimeout(timer);if(document.visibilityState!=='hidden')void update();};
   document.addEventListener('visibilitychange',visibility);void update();
   return()=>{abort.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);};
  },[]);
  R.useEffect(()=>{
   const servers=new Map(status.servers.map(server=>[server.id,server]));
   const routes=new Map(status.workspaces.map(workspace=>[normalizedPath(workspace.aliasPath),workspace]));
   const rows=new Map(workspaces.flatMap(workspace=>{const route=routes.get(normalizedPath(workspace.path));return route?[[`workspace:${workspace.workspaceId}`,servers.get(route.serverId)?.state||'idle']]:[];}));
   const clean=row=>{row.querySelectorAll('.dsh-ssh-connection-dot').forEach(dot=>dot.remove());row.querySelectorAll('.dsh-ssh-folder-status-anchor').forEach(anchor=>anchor.classList.remove('dsh-ssh-folder-status-anchor'));};
   let observer;
   const paint=()=>{
    observer?.disconnect();
    for(const row of document.querySelectorAll('[data-row-key^="workspace:"]')){
     const state=rows.get(row.dataset.rowKey);
     if(!state){clean(row);continue;}
     // The stock row's first span is the folder seat. Leave its SVG and click handlers intact.
     const anchor=row.firstElementChild;if(!anchor||anchor.tagName!=='SPAN'||!anchor.querySelector('svg'))continue;
     anchor.classList.add('dsh-ssh-folder-status-anchor');
     let dot=anchor.querySelector('.dsh-ssh-connection-dot');if(!dot){dot=document.createElement('span');dot.className='dsh-ssh-connection-dot';dot.setAttribute('role','img');anchor.append(dot);}
     dot.dataset.state=state;dot.title='SSH · '+(STATUS_LABELS[state]||STATUS_LABELS.unknown);dot.setAttribute('aria-label',dot.title);
    }
    observer?.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-row-key']});
   };
   observer=new MutationObserver(paint);paint();
   return()=>{observer.disconnect();document.querySelectorAll('[data-row-key^="workspace:"]').forEach(clean);};
  },[workspaces,status]);
  return h('style',null,STATUS_STYLE);
 }
