import {build} from 'esbuild';
import {readdir,readFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {extname,join,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const dist=join(root,'dist');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.mp3':'audio/mpeg','.txt':'text/plain; charset=utf-8'};
const publicFiles={};
async function collect(dir) {
  for (const entry of await readdir(dir,{withFileTypes:true})) {
    if(entry.name.startsWith('.') || ['server','client'].includes(entry.name)) continue;
    const path=join(dir,entry.name);
    if(entry.isDirectory()){await collect(path);continue;}
    const type=types[extname(path)];
    if(!entry.isFile() || !type)continue;
    const bytes=await readFile(path);
    const tag='"'+createHash('sha256').update(bytes).digest('hex').slice(0,24)+'"';
    publicFiles['/'+relative(dist,path).split(sep).join('/')]=[type,bytes.toString('base64'),tag];
  }
}
await collect(dist);
await mkdir(join(dist,'server'),{recursive:true});
await build({entryPoints:[join(root,'worker/index.mjs')],outfile:join(dist,'server/index.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',plugins:[{
  name:'offline-diary-assets',setup(builder){
    builder.onResolve({filter:/^nolimit:public-files$/},()=>({path:'files',namespace:'diary'}));
    builder.onLoad({filter:/.*/,namespace:'diary'},()=>({contents:'export const publicFiles='+JSON.stringify(publicFiles),loader:'js'}));
  }
}]});
console.log('Built diary worker with '+Object.keys(publicFiles).length+' public resources');
