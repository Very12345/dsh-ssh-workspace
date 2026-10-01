import fs from 'node:fs/promises';
const theme=await fs.readFile(new URL('../src/theme.css',import.meta.url),'utf8');
const extra=await fs.readFile(new URL('../src/picker.css',import.meta.url),'utf8');
const browser=await fs.readFile(new URL('../src/vendor/directory-browser.js',import.meta.url),'utf8');
const source=await fs.readFile(new URL('../src/client-source.js',import.meta.url),'utf8');
await fs.writeFile(new URL('../src/client.js',import.meta.url),source.replace('__DIRECTORY_BROWSER__',browser).replace(/\r\n?/g,'\n').replace('__SSH_STYLE__',JSON.stringify((theme+extra).replace(/\r\n?/g,'\n'))));
