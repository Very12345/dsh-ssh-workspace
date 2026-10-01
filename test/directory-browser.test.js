import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
test('stock directory browser differs only by header insertion and private style ID',async()=>{
 const source=await readFile(new URL('../node_modules/@deepseek-ai/dsh-client-ui-directory-picker-browse/lib/client.js',import.meta.url),'utf8');
 const stock=source.slice(source.indexOf('\t\tvar module ='),source.indexOf('\t\t//#region lib/types/client/flow.js'));
 const modified=stock.replace('function DirectoryBrowser({ open, listDirectory, createDirectory, onOpen, onClose, busy, t })','function DirectoryBrowser({ open, listDirectory, createDirectory, onOpen, onClose, busy, t, headerExtra })').replace('children: [(0, react_jsx_runtime.jsx)("h2", {','children: [headerExtra, (0, react_jsx_runtime.jsx)("h2", {').replace('const tagId = "@deepseek-ai/dsh-client-ui-directory-picker-browse/DirectoryBrowser.module.css";','const tagId = "@very12345/dsh-ssh-workspace/stock-directory-browser";');
 const actual=(await readFile(new URL('../src/vendor/directory-browser.js',import.meta.url),'utf8')).replace(/\r\n?/g,'\n');
 const normalize=s=>s.replace(/\r\n?/g,'\n').replace(/\/\/\#region \\0dsh-css:.*?\n/g,'').replace(/(?:ZuhsRW|Fv-y6W)/g,'STYLE');
 assert.equal(normalize(actual.split('function createDirectoryBrowser(require){\n')[1].split('\nreturn DirectoryBrowser;')[0]),normalize(modified));
});
