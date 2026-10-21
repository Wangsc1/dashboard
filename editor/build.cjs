// Run npm ci in editor/, then npm run build. Node modules are build/test-only.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const modules=process.env.EDITOR_MODULES||path.join(__dirname,'node_modules')
const esbuild=require(path.join(modules,'esbuild'))
const result=esbuild.buildSync({entryPoints:[path.join(__dirname,'main.js')],bundle:true,minify:true,write:false,format:'iife',target:['safari16'],legalComments:'inline',nodePaths:[modules],metafile:true})
const js=result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')
const sourceHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'main.js'))).digest('hex')
const target=path.join(__dirname,'../dashboard-pages.tsx')
const generated='// BEGIN GENERATED NIKKI EDITOR\n// CodeMirror/Lezer/YAML licenses: editor/THIRD_PARTY_NOTICES.txt; source SHA256 '+sourceHash+'\nconst NIKKI_EDITOR_JS = '+JSON.stringify(js)+'\n// END GENERATED NIKKI EDITOR'
const current=fs.readFileSync(target,'utf8')
if(!current.includes('// BEGIN GENERATED NIKKI EDITOR'))throw Error('Missing bundle marker')
fs.writeFileSync(target,current.replace(/\/\/ BEGIN GENERATED NIKKI EDITOR[\s\S]*?\/\/ END GENERATED NIKKI EDITOR/,()=>generated))

const packages=new Set()
for(const input of Object.keys(result.metafile.inputs)){const parts=input.split('node_modules/');if(parts.length<2)continue;const tail=parts.at(-1).split('/');packages.add(tail[0][0]==='@'?tail.slice(0,2).join('/'):tail[0])}
const notices=[]
for(const name of [...packages].sort()){
  const dir=path.join(modules,name),pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json')))
  const license=fs.readdirSync(dir).find(f=>/^licen[cs]e(\.|$)/i.test(f))
  if(!license)throw Error('Missing license: '+name)
  notices.push(name+' '+pkg.version+' ('+pkg.license+')\n'+fs.readFileSync(path.join(dir,license),'utf8'))
}
fs.writeFileSync(path.join(__dirname,'THIRD_PARTY_NOTICES.txt'),notices.join('\n\n==============================\n\n'))
console.log('Bundled '+js.length+' bytes from '+packages.size+' packages; source '+sourceHash)
