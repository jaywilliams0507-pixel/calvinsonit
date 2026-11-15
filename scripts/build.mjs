import {rm,mkdir,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
const rootFiles=['index.html','terms.html','privacy.html','audit.html','gbp.html','local.html'];
const directories=['ai-visibility-audit','catalog-cleanup','google-business-profile','automation','intake','contact','order','auth'];
await rm('dist',{recursive:true,force:true});
await mkdir('dist/assets',{recursive:true});
for(const file of rootFiles) await cp(file,`dist/${file}`);
for(const directory of directories) await cp(directory,`dist/${directory}`,{recursive:true});
async function copyAssets(directory) {
 for(const entry of await readdir(directory,{withFileTypes:true})) {
  const path=`${directory}/${entry.name}`;
  if(entry.isDirectory()) {await mkdir(`dist/${path}`,{recursive:true});await copyAssets(path);}
  else if(entry.isFile() && /\.(css|js|svg|png|ico|webp)$/.test(entry.name)) await cp(path,`dist/${path}`);
 }
}
await copyAssets('assets');
await build({entryPoints:['src/client.ts'],outfile:'dist/assets/app.js',bundle:true,minify:true,format:'esm',target:['es2022'],sourcemap:false});
await writeFile('dist/robots.txt','User-agent: *\nDisallow: /\n');
for(const path of [...rootFiles,...directories.filter(p=>p!=='auth').map(p=>`${p}/index.html`)]) {
  const html=await readFile(`dist/${path}`,'utf8');
  if(/https:\/\/buy\.stripe\.com\//.test(html)) throw new Error(`Live payment link in ${path}`);
}
console.log('Built allowlisted static assets and browser bundle. No secrets, source, CNAME, or documentation copied.');
