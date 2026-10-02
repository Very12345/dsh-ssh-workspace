window.__ModuleLoader__.load({id:'@very12345/dsh-ssh-workspace',factory:require=>{
 const R=require('react'),h=R.createElement;
 __DIRECTORY_BROWSER__
 const DirectoryBrowser=createDirectoryBrowser(require);
 const primitives=require('@deepseek-ai/dsh-client-ui-primitives');
 __CONNECTION_BADGES__
 const STYLE=__SSH_STYLE__;
 const rpc=async (input,signal)=>{const r=await fetch('/plugins/ssh-workspace',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal}:{signal});const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'请求失败');return input?data.value:data;};
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
    h('p',{className:'dshp-footnote'},'初始化从微软下载 VS Code CLI 1.140.0，保存于远端 ~/.dsh-ssh-workspace。'+ 'Linux/macOS 远端使用 Agent Host 运行环境。沿用会话的只读、工作区内修改和完全访问选择，由远端沙箱执行相应限制。'),
    c.error&&h('div',{className:'dshp-error',role:'alert'},c.error),...(c.data?.errors||[]).map((e,i)=>h('p',{className:'dshp-footnote',key:i},e)));
 }
 const browserCopy={'browser.title':'选择工作区目录','browser.home':'主目录','browser.newFolder':'新建文件夹','browser.folderName':'文件夹名称','browser.createIn':'在"{name}"中新建文件夹','browser.untitledFolder':'未命名文件夹','browser.create':'创建','browser.cancel':'取消','browser.open':'打开','browser.editPath':'编辑路径','browser.loading':'加载中…','browser.truncated':'文件夹过多，仅显示开头部分。','browser.showHidden':'显示隐藏文件'};
 const translate=(key,params)=>Object.entries(params||{}).reduce((text,[k,v])=>text.replaceAll('{'+k+'}',v),browserCopy[key]||key);
 function ProjectFlow({open,busy,onPicked,onCancel,onError,pickLocal,nativeLocal}){
  const c=useCatalog(),[computer,setComputer]=R.useState('local'),[working,setWorking]=R.useState(false),[failure,setFailure]=R.useState(''),generation=R.useRef(0),importing=R.useRef(new Map());
  R.useEffect(()=>{generation.current++;if(open){setComputer('local');setFailure('');void c.reload();}return()=>{generation.current++;};},[open]);
  const saved=c.data?.servers||[],aliases=(c.data?.configHosts||[]).filter(s=>!saved.some(x=>x.id===s.id));
  const resolveServer=R.useCallback(async()=>{
   const existing=saved.find(s=>s.id===computer);if(existing)return existing;
   const alias=aliases.find(s=>s.id===computer);if(!alias)throw new Error('所选电脑已移除');
   let promise=importing.current.get(computer);if(!promise){promise=rpc({action:'import',alias:alias.sshTarget});importing.current.set(computer,promise);promise.catch(()=>importing.current.delete(computer));}return promise;
  },[computer,c.data]);
  const listDirectory=R.useCallback(async(path,signal)=>computer==='local'?rpc({action:'local-list',path},signal):rpc({action:'list',id:(await resolveServer()).id,path},signal),[computer,resolveServer]);
  const createDirectory=R.useCallback(async(path,name)=>computer==='local'?rpc({action:'local-mkdir',path,name}):rpc({action:'mkdir',id:(await resolveServer()).id,path,name}),[computer,resolveServer]);
  const choose=async path=>{const token=generation.current;setWorking(true);try{const result=computer==='local'?{aliasPath:path}:await rpc({action:'project',id:(await resolveServer()).id,path});if(token===generation.current)onPicked(result.aliasPath);}catch(e){setFailure(e.message);}finally{if(token===generation.current)setWorking(false);}};
  const selector=h('div',{className:'ssh-computer-bar'},h('style',null,STYLE),h('label',null,'电脑',h('select',{'aria-label':'选择电脑','data-modal-autofocus':true,value:computer,disabled:busy||working,onChange:e=>{generation.current++;setFailure('');setComputer(e.target.value);}},h('option',{value:'local'},'本机电脑'),...saved.map(s=>h('option',{key:s.id,value:s.id},s.label)),...aliases.map(s=>h('option',{key:s.id,value:s.id},s.label+' · SSH config')))),failure&&h('div',{role:'alert',className:'ssh-picker-error'},failure));
  if(computer==='local'&&nativeLocal)return h(primitives.Modal,{open,onClose:onCancel,title:'选择工作区目录',closeLabel:'取消',className:'ssh-native-choice'},selector,h('div',{className:'ssh-native-actions'},h(primitives.Button,{onClick:onCancel},'取消'),h(primitives.Button,{variant:'primary',disabled:busy||working,onClick:async()=>{const token=generation.current;setWorking(true);try{const path=await pickLocal();if(token!==generation.current)return;if(path===null)onCancel();else onPicked(path);}catch(e){onError(e.message);}finally{if(token===generation.current)setWorking(false);}}},'选择文件夹')));
  return h(DirectoryBrowser,{key:computer,open,busy:busy||working,listDirectory,createDirectory,onOpen:choose,onClose:onCancel,t:translate,headerExtra:selector});
 }
 function apply(ctx){ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'ssh-workspace',label:'远程工作区',order:48},Settings));ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'ssh-workspace-status'},ConnectionBadges));for(const slot of ['sidebar.workspaces.directoryFlow','conversation.hero.workspace.directoryFlow'])ctx.slots.inject(slot,()=>ctx.slots.register({name:slot,id:'ssh-workspace',priority:-100,inject:()=>({nativeLocal:globalThis.__DSH_DIRECTORY_PICKER__!==undefined,pickLocal:()=>globalThis.__DSH_DIRECTORY_PICKER__?.pick()??ctx.uiWorkspace.pickDirectory()})},ProjectFlow));}
 return {name:'ssh-workspace-client',inject:['slots','uiWorkspace'],apply};
}});
