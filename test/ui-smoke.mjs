import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const base=new URL('../',import.meta.url),entries=new Map();let picked='',cancelled=false;
const catalog={ok:true,servers:[{id:'test',label:'开发服务器',sshTarget:'dev.example.invalid'}],workspaces:[],configHosts:[{id:'alias',label:'workstation',sshTarget:'workstation'}],configFile:'',errors:[]};
const fixture=`<!doctype html><html lang="zh"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:40px;font-family:system-ui,sans-serif;background:var(--dsw-alias-bg-layer-1,#f7f8fa)}body.dark{--dsw-alias-bg-layer-1:#151820;--dsw-alias-bg-layer-2:#20242c;--dsw-alias-bg-layer-3:#292f39;--dsw-alias-label-primary:#ecedf0;--dsw-alias-label-secondary:#a4acba;--dsw-alias-border-l3:#39414f}</style><div id="root"></div><script src="/react"></script><script src="/react-dom"></script><script>const entries=new Map();window.__ModuleLoader__={load({factory}){const plugin=factory(name=>name==='react'?React:null);plugin.apply({slots:{inject:(_name,callback)=>callback(),register:(o,c)=>{entries.set(o.name,{o,c});return()=>{};}}});window.fixture=(mode)=>{const name=mode==='settings'?'settings.section':'sidebar.workspaces.directoryFlow',Component=entries.get(name).c;window.priority=entries.get(name).o.priority;window.appRoot??=ReactDOM.createRoot(document.getElementById('root'));window.appRoot.render(React.createElement(Component,{open:true,busy:false,onPicked:p=>window.picked=p,onCancel:()=>window.cancelled=true,onError:e=>window.error=e}));};}};</script><script src="/client"></script><script>fixture('settings')</script></html>`;
const server=createServer(async(req,res)=>{try{
 if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fixture);}
 if(req.url==='/react'||req.url==='/react-dom'||req.url==='/client'){res.setHeader('Content-Type','text/javascript');const path=req.url==='/client'?'src/client.js':req.url==='/react'?'node_modules/react/umd/react.development.js':'node_modules/react-dom/umd/react-dom.development.js';return res.end(await readFile(new URL(path,base)));}
 if(req.url==='/plugins/ssh-workspace'){res.setHeader('Content-Type','application/json');if(req.method==='GET')return res.end(JSON.stringify(catalog));let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);let value=true;
 if(input.action==='list'||input.action==='local-list')value={path:input.path||(input.action==='local-list'?'C:\\Projects':'/home/dev'),home:'/home/dev',parent:'/',entries:[{name:'project alpha',path:'/home/dev/project alpha'}]};
 if(input.action==='project')value={aliasPath:'C:\\DSH\\remote-alias'};
 if(input.action==='add'){const s={id:'new',label:input.label||input.hostname,sshTarget:input.hostname};catalog.servers.push(s);value=s;}
 res.end(JSON.stringify({ok:true,value}));return;}
 res.writeHead(404);res.end();
 }catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,channel:process.env.DSH_UI_BROWSER_CHANNEL||(process.platform==='win32'?'msedge':undefined)});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.getByText('开发服务器',{exact:true}).waitFor();
 await mkdir(new URL('.tmp/ui/',base),{recursive:true});await page.screenshot({path:new URL('.tmp/ui/settings-light.png',base).pathname.replace(/^\/([A-Z]:)/,'$1')});
 await page.evaluate(()=>document.body.classList.add('dark'));await page.screenshot({path:new URL('.tmp/ui/settings-dark.png',base).pathname.replace(/^\/([A-Z]:)/,'$1')});
 await page.getByRole('button',{name:'添加电脑',exact:true}).click();await page.getByText('主机地址',{exact:true}).locator('..').locator('input').fill('new.example.invalid');await page.getByRole('button',{name:'添加电脑',exact:true}).last().click();await page.getByText('new.example.invalid',{exact:true}).first().waitFor();
 await page.evaluate(()=>fixture('project'));await page.getByRole('button',{name:'开发服务器',exact:true}).click();await page.getByRole('button',{name:'project alpha'}).waitFor();assert.equal(await page.evaluate(()=>priority),-100);
 await page.screenshot({path:new URL('.tmp/ui/picker-dark.png',base).pathname.replace(/^\/([A-Z]:)/,'$1')});
 await page.getByRole('button',{name:'project alpha'}).click();await page.getByRole('button',{name:'使用此目录'}).click();await page.waitForFunction(()=>window.picked==='C:\\DSH\\remote-alias');
 await page.getByRole('button',{name:'本机电脑'}).click();await page.getByRole('button',{name:'使用此目录'}).click();await page.waitForFunction(()=>window.picked==='C:\\Projects');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:new URL('.tmp/ui/picker-mobile.png',base).pathname.replace(/^\/([A-Z]:)/,'$1')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.cancelled),true);assert.deepEqual(errors,[]);console.log('UI: settings, manual host, local/SSH picker, priority, responsive layout and Escape PASS');
}finally{await browser.close();await new Promise(r=>server.close(r));}
