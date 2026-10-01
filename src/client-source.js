window.__ModuleLoader__.load({id:'@very12345/dsh-ssh-workspace',factory:require=>{
 const R=require('react'),h=R.createElement;
 const STYLE=__SSH_STYLE__;
 const rpc=async input=>{const r=await fetch('/plugins/ssh-workspace',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined);const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'请求失败');return input?data.value:data;};
 const Icon=()=>h('svg',{width:22,height:22,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:1.6},h('rect',{x:3,y:4,width:18,height:12,rx:2}),h('path',{d:'M8 20h8M12 16v4M6 8l3 2-3 2M11 12h4'}));
 function useCatalog(){const [data,setData]=R.useState(null),[error,setError]=R.useState('');const reload=R.useCallback(async()=>{try{setData(await rpc());setError('');}catch(e){setError(e.message);}},[]);R.useEffect(()=>{void reload();},[reload]);return {data,error,setError,reload};}
 function HostForm({onDone,onCancel}){const [input,setInput]=R.useState({hostname:'',username:'',port:22,label:'',identityFile:'',proxyJump:''}),[busy,setBusy]=R.useState(false),[error,setError]=R.useState('');const field=(key,label,placeholder)=>h('label',{className:'ssh-field',key},h('span',null,label),h('input',{value:input[key],placeholder,onChange:e=>setInput({...input,[key]:e.target.value}),autoComplete:'off'}));return h('form',{className:'dshp-form',onSubmit:async e=>{e.preventDefault();setBusy(true);try{await rpc({action:'add',...input});await onDone();}catch(e){setError(e.message);}finally{setBusy(false);}}},h('div',{className:'ssh-grid'},field('hostname','主机地址','example.com'),field('username','用户名','远端账户'),field('port','端口','22'),field('label','显示名称','可选'),field('identityFile','密钥文件路径','可选，使用 ssh-agent 或 SSH config'),field('proxyJump','跳板机','可选，SSH config 别名')),h('p',{className:'dshp-help'},'使用系统 OpenSSH；密码和密钥口令由 ssh-agent 管理，不保存在插件中。'),error&&h('div',{role:'alert',className:'dshp-error'},error),h('div',{className:'dshp-actions'},h('button',{className:'dshp-button dshp-primary',disabled:busy,type:'submit'},busy?'保存中…':'添加电脑'),h('button',{className:'dshp-button',type:'button',onClick:onCancel},'取消')));}
 function Settings(){
  const c=useCatalog(),[adding,setAdding]=R.useState(false),[config,setConfig]=R.useState(''),[busy,setBusy]=R.useState(false);
  R.useEffect(()=>{if(c.data)setConfig(c.data.configFile);},[c.data?.configFile]);
  const operate=async input=>{setBusy(true);try{await rpc(input);await c.reload();}catch(e){c.setError(e.message);}finally{setBusy(false);}};
  const saved=(c.data?.servers||[]).map(server=>h('div',{className:'dshp-row',key:server.id},
    h('div',null,h('p',{className:'dshp-label'},server.label),h('p',{className:'dshp-help'},server.sshTarget)),
    h('div',{className:'dshp-actions'},h('button',{className:'dshp-button',disabled:busy,onClick:()=>operate({action:'initialize',id:server.id})},'初始化环境'),h('button',{className:'dshp-button dshp-danger',disabled:busy,onClick:()=>{if(window.confirm('移除连接？远端文件不会删除。'))void operate({action:'remove',id:server.id});}},'移除'))));
  const aliases=(c.data?.configHosts||[]).map(server=>{const imported=c.data.servers.some(x=>x.id===server.id);return h('div',{className:'dshp-row',key:server.id},h('div',null,h('p',{className:'dshp-label'},server.label),h('p',{className:'dshp-help'},'来自 SSH config')),h('button',{className:'dshp-button',disabled:busy||imported,onClick:()=>operate({action:'import',alias:server.sshTarget})},imported?'已添加':'添加'));});
  return h('section',{className:'dshp-page'},h('style',null,STYLE),
    h('header',{className:'dshp-header'},h('div',{className:'dshp-title'},h('span',{className:'dshp-symbol'},h(Icon)),h('div',null,h('h2',null,'远程工作区'),h('p',{className:'dshp-subtitle'},'本机界面，远端项目。'))),h('button',{className:'dshp-button dshp-primary',onClick:()=>setAdding(true)},'添加电脑')),
    adding&&h('div',{className:'dshp-panel'},h(HostForm,{onDone:async()=>{setAdding(false);await c.reload();},onCancel:()=>setAdding(false)})),
    h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'已保存的电脑'),h('div',{className:'dshp-panel'},...saved),!saved.length&&h('p',{className:'dshp-footnote'},'添加电脑后，新建项目时即可选择远程目录。')),
    h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'SSH config'),h('div',{className:'dshp-panel'},
      h('div',{className:'dshp-row'},h('label',{className:'ssh-field ssh-grow'},h('span',null,'配置文件'),h('input',{value:config,placeholder:'留空使用 ~/.ssh/config',onChange:e=>setConfig(e.target.value)})),h('button',{className:'dshp-button',disabled:busy,onClick:()=>operate({action:'config',path:config})},'应用')),
      h('div',{className:'ssh-config-list'},...aliases)),h('p',{className:'dshp-footnote'},'沿用 OpenSSH 的 Host、Include、IdentityFile 和 ProxyJump 配置。主机密钥必须先在系统 SSH 中信任。')),
    h('p',{className:'dshp-footnote'},'初始化从微软下载 VS Code CLI 1.140.0，保存于远端 ~/.dsh-ssh-workspace。'+ 'Linux/macOS 远端使用 Agent Host 运行环境。命令按远端账户权限执行，受限会话需在原生权限选择中启用完全访问。'),
    c.error&&h('div',{className:'dshp-error',role:'alert'},c.error),...(c.data?.errors||[]).map((e,i)=>h('p',{className:'dshp-footnote',key:i},e)));
 }
 function ProjectFlow({open,busy,onPicked,onCancel,onError}){
  const c=useCatalog(),[host,setHost]=R.useState(null),[listing,setListing]=R.useState(null),[draft,setDraft]=R.useState(''),[working,setWorking]=R.useState(false),[adding,setAdding]=R.useState(false),generation=R.useRef(0);
  R.useEffect(()=>{if(open){setHost(null);setListing(null);c.setError('');void c.reload();}return()=>{generation.current++;};},[open]);
  const browse=async(server,path)=>{const token=++generation.current;setHost(server);setListing(null);setWorking(true);c.setError('');try{const result=await rpc({action:server.id==='local'?'local-list':'list',id:server.id,path});if(token===generation.current){setListing(result);setDraft(result.path);}}catch(e){if(token===generation.current)c.setError(e.message);}finally{if(token===generation.current)setWorking(false);}};
  const promote=async server=>{setWorking(true);try{const saved=await rpc({action:'import',alias:server.sshTarget});await c.reload();await browse(saved);}catch(e){c.setError(e.message);setWorking(false);}};
  R.useEffect(()=>{if(!open)return;const previous=document.activeElement;const key=e=>{if(e.key==='Escape'&&!busy)onCancel();};document.addEventListener('keydown',key);const timer=setTimeout(()=>document.querySelector('.ssh-dialog button')?.focus(),0);return()=>{clearTimeout(timer);document.removeEventListener('keydown',key);previous?.focus?.();};},[open,busy,onCancel]);
  if(!open)return null;
  const saved=(c.data?.servers||[]).map(server=>h('button',{className:'ssh-host','data-selected':host?.id===server.id,key:server.id,onClick:()=>browse(server),disabled:working||busy},server.label));
  const config=(c.data?.configHosts||[]).filter(server=>!c.data.servers.some(x=>x.id===server.id)).map(server=>h('button',{className:'ssh-host',key:server.id,onClick:()=>promote(server),disabled:working||busy},server.label));
  const directories=(listing?.entries||[]).map(entry=>h('button',{className:'ssh-directory',key:entry.path,onClick:()=>browse(host,entry.path)},h('span',null,'▱'),entry.name));
  let content;
  if(adding)content=h(HostForm,{onDone:async()=>{setAdding(false);await c.reload();},onCancel:()=>setAdding(false)});
  else if(!host)content=h('div',{className:'ssh-welcome'},h(Icon),h('p',null,'选择一台电脑，浏览其中的项目目录。'));
  else content=h(R.Fragment,null,
    h('div',{className:'ssh-path'},h('input',{value:draft,onChange:e=>setDraft(e.target.value),'aria-label':'远程目录',onKeyDown:e=>{if(e.key==='Enter')void browse(host,draft);}}),h('button',{className:'dshp-button',disabled:working,onClick:()=>browse(host,draft)},'前往')),
    h('div',{className:'dshp-actions'},h('button',{className:'dshp-button',disabled:working,onClick:()=>browse(host,listing?.home)},'主目录'),h('button',{className:'dshp-button',disabled:working||!listing?.parent,onClick:()=>browse(host,listing.parent)},'上一级')),
    working?h('p',{role:'status',className:'dshp-footnote'},'正在连接远端环境…'):h('div',{className:'ssh-directories'},...directories),
    h('p',{className:'dshp-footnote'},host.id==='local'?'本机目录。': '首次连接可初始化插件专用 Agent Host 环境；远端命令需要原生完全访问权限。'),
    host.id!=='local'&&h('button',{className:'dshp-button',disabled:working||busy,onClick:async()=>{setWorking(true);try{await rpc({action:'initialize',id:host.id});await c.reload();await browse(host);}catch(e){c.setError(e.message);setWorking(false);}}},'初始化远端环境'),
    h('button',{className:'dshp-button dshp-primary',disabled:working||busy||!listing,onClick:async()=>{const token=generation.current;setWorking(true);try{if(host.id==='local')onPicked(listing.path);else {const project=await rpc({action:'project',id:host.id,path:listing.path});if(token===generation.current)onPicked(project.aliasPath);}}catch(e){c.setError(e.message);}finally{setWorking(false);}}},busy?'正在创建项目…':'使用此目录'));
  return h('div',{className:'ssh-backdrop'},h('style',null,STYLE),h('section',{className:'dshp-page ssh-dialog',role:'dialog','aria-modal':true,'aria-label':'选择项目位置'},
    h('header',{className:'dshp-header'},h('div',{className:'dshp-title'},h(Icon),h('div',null,h('h2',null,'选择项目位置'),h('p',{className:'dshp-subtitle'},'本机或通过 SSH 连接的电脑'))),h('button',{className:'dshp-button',disabled:busy,onClick:onCancel},'关闭')),
    h('div',{className:'ssh-picker'},h('aside',{className:'ssh-hosts'},h('button',{className:'ssh-host','data-selected':host?.id==='local',disabled:working||busy,onClick:()=>browse({id:'local',label:'本机电脑'})},'本机电脑'),h('p',{className:'dshp-heading'},'已保存'),...saved,h('p',{className:'dshp-heading'},'SSH config'),...config,h('button',{className:'dshp-button',onClick:()=>setAdding(true)},'+ 添加电脑')),h('main',{className:'ssh-browser'},content)),
    c.error&&h('div',{className:'dshp-error',role:'alert'},c.error)));
 }
 function apply(ctx){ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'ssh-workspace',label:'远程工作区',order:48},Settings));for(const slot of ['sidebar.workspaces.directoryFlow','conversation.hero.workspace.directoryFlow'])ctx.slots.inject(slot,()=>ctx.slots.register({name:slot,id:'ssh-workspace',priority:-100},ProjectFlow));}
 return {name:'ssh-workspace-client',inject:['slots'],apply};
}});
