window.__ModuleLoader__.load({id:'@very12345/dsh-ssh-workspace',factory:require=>{
 const R=require('react'),h=R.createElement;
 __DIRECTORY_BROWSER__
 const DirectoryBrowser=createDirectoryBrowser(require);
 __CONNECTION_BADGES__
 __COMPUTER_SELECTOR__
    const SETTINGS_ICON_SVG = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" xmlns=\"http://www.w3.org/2000/svg\" fill=\"currentColor\"><path d=\"M3.14573 5.14704C3.34064 4.95221 3.65776 4.95237 3.85277 5.14704L7.85277 9.14704L7.85374 9.14606C8.04873 9.34105 8.0487 9.65809 7.85374 9.8531L3.85374 13.8531C3.7558 13.951 3.62815 13.9995 3.50023 13.9996C3.37223 13.9996 3.24373 13.9501 3.14573 13.8531C2.95103 13.6581 2.95083 13.341 3.14573 13.1461L6.79222 9.50056L3.14573 5.85407C2.95104 5.65905 2.95084 5.34194 3.14573 5.14704Z\"/><path d=\"M12.1457 1.14704C12.3406 0.952206 12.6578 0.952371 12.8528 1.14704C13.0477 1.34202 13.0477 1.65907 12.8528 1.85407L9.20726 5.50056L12.8537 9.14704C13.0487 9.34202 13.0487 9.65907 12.8537 9.85407C12.7558 9.95101 12.6282 10.0005 12.5002 10.0006C12.3722 10.0006 12.2437 9.95207 12.1457 9.85407L8.14573 5.85407C7.95104 5.65905 7.95084 5.34194 8.14573 5.14704L12.1457 1.14704Z\"/></svg>";
    const SettingsIcon = ({size = 20} = {}) => h("svg", {width:size, height:size, ...{"viewBox": "0 0 16 16", "fill": "currentColor", "aria-hidden": true, "focusable": false}}, h("path", {"d": "M3.14573 5.14704C3.34064 4.95221 3.65776 4.95237 3.85277 5.14704L7.85277 9.14704L7.85374 9.14606C8.04873 9.34105 8.0487 9.65809 7.85374 9.8531L3.85374 13.8531C3.7558 13.951 3.62815 13.9995 3.50023 13.9996C3.37223 13.9996 3.24373 13.9501 3.14573 13.8531C2.95103 13.6581 2.95083 13.341 3.14573 13.1461L6.79222 9.50056L3.14573 5.85407C2.95104 5.65905 2.95084 5.34194 3.14573 5.14704Z"}), h("path", {"d": "M12.1457 1.14704C12.3406 0.952206 12.6578 0.952371 12.8528 1.14704C13.0477 1.34202 13.0477 1.65907 12.8528 1.85407L9.20726 5.50056L12.8537 9.14704C13.0487 9.34202 13.0487 9.65907 12.8537 9.85407C12.7558 9.95101 12.6282 10.0005 12.5002 10.0006C12.3722 10.0006 12.2437 9.95207 12.1457 9.85407L8.14573 5.85407C7.95104 5.65905 7.95084 5.34194 8.14573 5.14704L12.1457 1.14704Z"}));

    // DSH 0.2 uses a fixed nav glyph lookup. Limit this compatibility styling
    // to our own exact label in the native settings rail; leave React's SVG
    // node and all navigation/focus handlers intact. Keep SVG with assets/settings-icon.svg.
    function installSettingsNavIcon(ctx) {
      const doc = globalThis.document;
      if (!doc?.body || typeof globalThis.MutationObserver !== 'function' || typeof ctx.effect !== 'function') return;
      ctx.effect(() => {
        const attribute = 'data-dsh-plugin-settings-icon', owner = "ssh-workspace";
        const selector = '[data-shortcut-modal="settings"] nav';
        const style = doc.createElement('style');
        const mask = 'url("data:image/svg+xml,' + encodeURIComponent(SETTINGS_ICON_SVG) + '")';
        const own = selector + ' button[' + attribute + '="' + owner + '"]';
        style.textContent = own + '>svg{display:none!important}' + own + '::before{content:"";display:block;width:16px;height:16px;flex:none;background:currentColor;-webkit-mask:' + mask + ' center/contain no-repeat;mask:' + mask + ' center/contain no-repeat}';
        doc.head.appendChild(style);
        const marked = new Set();
        let nav = null;
        const decorate = () => {
          for (const button of marked) if (!button.isConnected || button.textContent.trim() !== "远程工作区") {
            if (button.getAttribute(attribute) === owner) button.removeAttribute(attribute);
            marked.delete(button);
          }
          for (const button of Array.from(nav?.querySelectorAll('button') || [])) {
            if (button.textContent.trim() !== "远程工作区" || button.firstElementChild?.tagName.toLowerCase() !== 'svg') continue;
            button.setAttribute(attribute, owner);
            marked.add(button);
          }
        };
        const rail = new MutationObserver(decorate);
        const mount = () => {
          const next = doc.querySelector(selector);
          if (next !== nav) {
            rail.disconnect(); nav = next;
            if (nav) rail.observe(nav, {childList:true, subtree:true, characterData:true});
          }
          decorate();
        };
        const root = new MutationObserver(mount);
        root.observe(doc.body, {childList:true});
        mount();
        return () => {
          root.disconnect(); rail.disconnect(); style.remove();
          for (const button of marked) if (button.getAttribute(attribute) === owner) button.removeAttribute(attribute);
          marked.clear();
        };
      });
    }

 const STYLE=__SSH_STYLE__;
 const rpc=async (input,signal)=>{const r=await fetch('/plugins/ssh-workspace',input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal}:{signal});const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'请求失败');return input?data.value:data;};
 function useCatalog(){const [data,setData]=R.useState(null),[error,setError]=R.useState('');const reload=R.useCallback(async()=>{try{setData(await rpc());setError('');}catch(e){setError(e.message);}},[]);R.useEffect(()=>{void reload();},[reload]);return {data,error,setError,reload};}
 function HostForm({onDone,onCancel}){const [input,setInput]=R.useState({hostname:'',username:'',port:22,label:'',identityFile:'',proxyJump:''}),[busy,setBusy]=R.useState(false),[error,setError]=R.useState('');const field=(key,label,placeholder)=>h('label',{className:'ssh-field',key},h('span',null,label),h('input',{value:input[key],placeholder,onChange:e=>setInput({...input,[key]:e.target.value}),autoComplete:'off'}));return h('form',{className:'dshp-form',onSubmit:async e=>{e.preventDefault();setBusy(true);try{await rpc({action:'add',...input});await onDone();}catch(e){setError(e.message);}finally{setBusy(false);}}},h('div',{className:'ssh-grid'},field('hostname','主机地址','example.com'),field('username','用户名','远端账户'),field('port','端口','22'),field('label','显示名称','可选'),field('identityFile','密钥文件路径','可选，使用 ssh-agent 或 SSH config'),field('proxyJump','跳板机','可选，SSH config 别名')),h('p',{className:'dshp-help'},'使用系统 OpenSSH；密码和密钥口令由 ssh-agent 管理，不保存在插件中。'),error&&h('div',{role:'alert',className:'dshp-error'},error),h('div',{className:'dshp-actions'},h('button',{className:'dshp-button dshp-primary',disabled:busy,type:'submit'},busy?'保存中…':'添加电脑'),h('button',{className:'dshp-button',type:'button',onClick:onCancel},'取消')));}
 function Settings(){
  const c=useCatalog(),[adding,setAdding]=R.useState(false),[config,setConfig]=R.useState(''),[busy,setBusy]=R.useState(false),[notice,setNotice]=R.useState('');
  R.useEffect(()=>{if(c.data)setConfig(c.data.configFile);},[c.data?.configFile]);
  const operate=async input=>{setBusy(true);try{await rpc(input);await c.reload();}catch(e){c.setError(e.message);}finally{setBusy(false);}};
  const saved=(c.data?.servers||[]).map(server=>h('div',{className:'dshp-row',key:server.id},
    h('div',null,h('p',{className:'dshp-label'},server.label),h('p',{className:'dshp-help'},server.sshTarget)),
    h('div',{className:'dshp-actions'},h('button',{className:'dshp-button',disabled:busy,onClick:()=>operate({action:'initialize',id:server.id})},'初始化环境'),h('button',{className:'dshp-button dshp-danger',disabled:busy,onClick:()=>{if(window.confirm('移除连接？远端文件不会删除。'))void operate({action:'remove',id:server.id});}},'移除'))));
  const aliases=(c.data?.configHosts||[]).map(server=>{const imported=c.data.servers.some(x=>x.id===server.id);return h('div',{className:'dshp-row',key:server.id},h('div',null,h('p',{className:'dshp-label'},server.label),h('p',{className:'dshp-help'},'来自 SSH config')),h('button',{className:'dshp-button',disabled:busy||imported,onClick:()=>operate({action:'import',alias:server.sshTarget})},imported?'已添加':'添加'));});
  return h('section',{className:'dshp-page'},h('style',null,STYLE),
    h('header',{className:'dshp-header'},h('div',{className:'dshp-title'},h('span',{className:'dshp-symbol'},h(SettingsIcon)),h('div',null,h('h2',null,'远程工作区'),h('p',{className:'dshp-subtitle'},'本机界面，远端项目。'))),h('button',{className:'dshp-button dshp-primary',onClick:()=>setAdding(true)},'添加电脑')),
    adding&&h('div',{className:'dshp-panel'},h(HostForm,{onDone:async()=>{setAdding(false);await c.reload();},onCancel:()=>setAdding(false)})),
    h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'已保存的电脑'),h('div',{className:'dshp-panel'},...saved),!saved.length&&h('p',{className:'dshp-footnote'},'添加电脑后，新建项目时即可选择远程目录。')),
    h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'远程项目'),h('div',{className:'dshp-panel'},...(c.data?.workspaces||[]).map(project=>h('div',{className:'dshp-row',key:project.id},h('div',null,h('p',{className:'dshp-label'},c.data.servers.find(server=>server.id===project.serverId)?.label||'已移除的电脑'),h('p',{className:'dshp-help'},project.remotePath)),h('button',{className:'dshp-button dshp-danger',disabled:busy,onClick:()=>{if(window.confirm('移除这个远程项目？远端文件和对话记录会保留，本机非空目录不会自动删除。'))void operate({action:'workspace-remove',id:project.id});}},'移除项目')))),h('p',{className:'dshp-footnote'},'侧栏删除会同步移除连接映射。文件在远端读取；本机仅保留占位目录。'),h('div',{className:'dshp-actions'},h('button',{className:'dshp-button',disabled:busy,onClick:async()=>{setBusy(true);try{const result=await rpc({action:'cleanup-local'});setNotice('已清理 '+result.removed+' 个空占位目录；非空或自定义目录保留。');await c.reload();}catch(e){c.setError(e.message);}finally{setBusy(false);}}},'清理本机残留')),notice&&h('p',{className:'dshp-footnote',role:'status'},notice)),
    h('section',{className:'dshp-section'},h('h3',{className:'dshp-heading'},'SSH config'),h('div',{className:'dshp-panel'},
      h('div',{className:'dshp-row'},h('label',{className:'ssh-field ssh-grow'},h('span',null,'配置文件'),h('input',{value:config,placeholder:'留空使用 ~/.ssh/config',onChange:e=>setConfig(e.target.value)})),h('button',{className:'dshp-button',disabled:busy,onClick:()=>operate({action:'config',path:config})},'应用')),
      h('div',{className:'ssh-config-list'},...aliases)),h('p',{className:'dshp-footnote'},'沿用 OpenSSH 的 Host、Include、IdentityFile 和 ProxyJump 配置。主机密钥必须先在系统 SSH 中信任。')),
    h('p',{className:'dshp-footnote'},'初始化从微软下载 VS Code CLI 1.140.0，保存于远端 ~/.dsh-ssh-workspace。'+ 'Linux/macOS 远端使用 Agent Host 运行环境。沿用会话的只读、工作区内修改和完全访问选择，由远端沙箱执行相应限制。'),
    c.error&&h('div',{className:'dshp-error',role:'alert'},c.error),...(c.data?.errors||[]).map((e,i)=>h('p',{className:'dshp-footnote',key:i},e)));
 }
 const browserCopy={'browser.title':'选择工作区目录','browser.home':'主目录','browser.newFolder':'新建文件夹','browser.folderName':'文件夹名称','browser.createIn':'在"{name}"中新建文件夹','browser.untitledFolder':'未命名文件夹','browser.create':'创建','browser.cancel':'取消','browser.open':'打开','browser.editPath':'编辑路径','browser.loading':'加载中…','browser.truncated':'文件夹过多，仅显示开头部分。','browser.showHidden':'显示隐藏文件'};
 const translate=(key,params)=>Object.entries(params||{}).reduce((text,[k,v])=>text.replaceAll('{'+k+'}',v),browserCopy[key]||key);
 function ProjectFlow({open,busy,onPicked,onCancel}){
  const c=useCatalog(),[computer,setComputer]=R.useState('local'),[working,setWorking]=R.useState(false),[failure,setFailure]=R.useState(''),generation=R.useRef(0),importing=R.useRef(new Map());
  const [status,setStatus]=R.useState({servers:[]});
  R.useEffect(()=>{if(open)return pollConnectionStatus({onData:setStatus,onError:()=>setStatus(value=>({...value,failed:true,servers:value.servers.map(server=>({...server,state:'unknown'}))}))});},[open]);
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
  const states=new Map(status.servers.map(server=>[server.id,server.state]));
  const options=[{id:'local',label:'本机电脑'},...saved.map(server=>({...server,state:states.get(server.id)||(status.failed?'unknown':'idle')})),...aliases.map(server=>({...server,state:states.get(server.id)||(status.failed?'unknown':'idle')}))];
  const selector=h(R.Fragment,null,h('style',null,STYLE),h(ComputerSelector,{value:computer,options,disabled:busy||working,onChange:value=>{generation.current++;setFailure('');setComputer(value);}}));
  return h(DirectoryBrowser,{key:computer,open,busy:busy||working,listDirectory,createDirectory,onOpen:choose,onClose:onCancel,t:translate,headerExtra:selector,headerMessage:failure&&h('div',{role:'alert',className:'ssh-picker-error'},failure)});
 }
 function apply(ctx){
      installSettingsNavIcon(ctx);ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'ssh-workspace',label:'远程工作区',order:48},Settings));ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'ssh-workspace-status'},ConnectionBadges));for(const slot of ['sidebar.workspaces.directoryFlow','conversation.hero.workspace.directoryFlow'])ctx.slots.inject(slot,()=>ctx.slots.register({name:slot,id:'ssh-workspace',priority:-100},ProjectFlow));}
 return {name:'ssh-workspace-client',inject:['slots'],apply};
}});
