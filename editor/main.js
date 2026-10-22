// CodeMirror 6 + Lezer YAML, fully bundled. No config is interpolated into this script.
import {EditorState, Compartment, StateField, StateEffect} from '@codemirror/state'
import {EditorView, ViewPlugin, Decoration, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection} from '@codemirror/view'
import {history, historyKeymap, invertedEffects, defaultKeymap, indentWithTab, undo, redo, undoDepth, redoDepth} from '@codemirror/commands'
import {yaml} from '@codemirror/lang-yaml'
import {syntaxTree, syntaxHighlighting, HighlightStyle, foldGutter, foldKeymap, bracketMatching, indentUnit, foldAll, unfoldAll} from '@codemirror/language'
import {search, searchKeymap, openSearchPanel} from '@codemirror/search'
import {tags} from '@lezer/highlight'
import {parseDocument, isScalar} from 'yaml'
import {indentationMarkers} from '@replit/codemirror-indentation-markers'

const editable = new Compartment(), palette = new Compartment()
let raw='', generation=0, revision=0, view, locked=false, snapshotEpoch=0
const post=(name,value)=>window.webkit.messageHandlers[name].postMessage(value)
const colors=HighlightStyle.define([
  {tag:tags.propertyName,color:'var(--key)'}, {tag:tags.number,color:'var(--number)'},
  {tag:[tags.bool,tags.null],color:'var(--bool)'},
  {tag:[tags.string,tags.content,tags.special(tags.string)],color:'var(--string)'},
  {tag:tags.comment,color:'var(--comment)'}, {tag:tags.meta,color:'var(--number)'}
])
// Lezer deliberately labels unquoted scalars as generic content. Resolve only
// visible Literal nodes with the mature YAML 1.2 parser, never regex-guess a YAML
// document or rewrite it. Keys, quoted/block strings, tags and aliases remain the
// language parser's responsibility. Decorations are display-only.
const scalarColors=ViewPlugin.fromClass(class {
  constructor(view){this.tree=syntaxTree(view.state);this.decorations=this.color(view)}
  update(update){const tree=syntaxTree(update.state);if(update.docChanged||update.viewportChanged||tree!==this.tree){this.tree=tree;this.decorations=this.color(update.view)}}
  color(view){const ranges=[];for(const range of view.visibleRanges)this.tree.iterate({from:range.from,to:range.to,enter:node=>{
    if(node.name!=='Literal'||node.node.parent?.name==='Key')return
    const parsed=parseDocument(view.state.sliceDoc(node.from,node.to),{logLevel:'silent',prettyErrors:false}).contents
    if(!isScalar(parsed))return
    const type=typeof parsed.value,kind=type==='number'?'number':type==='boolean'||parsed.value===null?'bool':null
    if(kind)ranges.push(Decoration.mark({class:'cm-scalar-'+kind}).range(node.from,node.to))
  }});return Decoration.set(ranges,true)}
},{decorations:p=>p.decorations})
const theme=dark=>EditorView.theme({
  '&':{height:'100%',fontSize:'14px',color:'var(--fg)',backgroundColor:'var(--bg)'},
  '.cm-scroller':{fontFamily:'ui-monospace,SFMono-Regular,Menlo,monospace',lineHeight:'21px',overflow:'auto'},
  '.cm-content':{padding:'8px 0',minHeight:'100%',caretColor:'var(--fg)'},
  '.cm-line':{padding:'0 8px'},
  '.cm-gutters':{backgroundColor:'var(--bg)',color:'var(--comment)',border:'none'},
  '.cm-lineNumbers .cm-gutterElement':{padding:'0 7px',minWidth:'3ch'},
  '.cm-activeLine, .cm-activeLineGutter':{backgroundColor:'var(--active)'},
  '.cm-cursor':{borderLeftColor:'var(--fg)'},
  '&.cm-focused':{outline:'none'}, '.cm-foldPlaceholder':{background:'var(--active)',border:'none',color:'var(--comment)'},
  '.cm-panels':{background:'var(--bar)',color:'var(--fg)'},
  '.cm-search':{fontSize:'14px'}, '.cm-textfield':{fontSize:'16px',color:'var(--fg)',background:'var(--bg)'},
  '.cm-button':{color:'var(--fg)',background:'var(--bg)',fontSize:'13px'},
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{background:'var(--selection)'}
},{dark})
const media=window.matchMedia('(prefers-color-scheme: dark)')
let appearance='system'
function setTheme(value){appearance=value;const dark=value==='dark'||value!=='light'&&media.matches;document.documentElement.dataset.theme=dark?'dark':'light';if(view)view.dispatch({effects:palette.reconfigure(theme(dark))})}
media.addEventListener('change',()=>{if(appearance==='system')setTheme('system')})
function rawOffset(text,offset){let raw=0,n=0;while(n<offset){if(text[raw]==='\r'&&text[raw+1]==='\n')raw++;raw++;n++}return raw}
// Apply exact CodeMirror change ranges to the full raw buffer. Untouched mixed line
// endings stay byte-for-byte, even for multiple cursors; no YAML serialization occurs.
function applyRaw(text,changes){const newline=text.match(/\r\n|\r|\n/)?.[0]??'\n';let out='',pos=0;changes.iterChanges((from,to,_a,_b,insert)=>{const a=rawOffset(text,from),b=rawOffset(text,to);out+=text.slice(pos,a)+insert.toString().replace(/\n/g,newline);pos=b});return out+text.slice(pos)}
// Raw line endings travel with CodeMirror history as inverted effects. Grouped edits,
// composition, undo/redo and history trimming therefore retain the exact original bytes.
const restoreRaw=StateEffect.define()
const rawField=StateField.define({create:()=>raw,update(value,tr){let restored=null;for(const effect of tr.effects)if(effect.is(restoreRaw))restored=effect.value;return restored!==null?restored:tr.docChanged?applyRaw(value,tr.changes):value}})
function updated(update){if(!update.docChanged)return;raw=update.state.field(rawField);revision++;post('editorChanged',{text:raw,revision,generation});buttons()}
function buttons(){document.getElementById('undo').disabled=locked||!view||!undoDepth(view.state);document.getElementById('redo').disabled=locked||!view||!redoDepth(view.state)}
function makeState(text){return EditorState.create({doc:text.replace(/\r\n|\r/g,'\n'),extensions:[
  rawField,invertedEffects.of(tr=>tr.docChanged?[restoreRaw.of(tr.startState.field(rawField))]:[]),yaml(),scalarColors,lineNumbers(),foldGutter(),history(),drawSelection(),highlightActiveLine(),highlightActiveLineGutter(),bracketMatching(),
  indentUnit.of('  '),indentationMarkers({highlightActiveBlock:true}),syntaxHighlighting(colors),
  search({top:true}),keymap.of([...defaultKeymap,...historyKeymap,...searchKeymap,...foldKeymap,indentWithTab]),
  EditorView.contentAttributes.of({spellcheck:'false',autocorrect:'off',autocapitalize:'off','aria-label':'配置内容'}),
  EditorView.updateListener.of(updated),editable.of([EditorView.editable.of(true),EditorState.readOnly.of(false)]),palette.of(theme(document.documentElement.dataset.theme==='dark'))
]})}
function lock(value){locked=value;view.dispatch({effects:editable.reconfigure([EditorView.editable.of(!value),EditorState.readOnly.of(value)])});buttons()}
function setText(text,token,themeName){raw=text;generation=token;revision=0;locked=false;snapshotEpoch++;setTheme(themeName);if(view){view.setState(makeState(text));view.scrollDOM.scrollTop=0;view.scrollDOM.scrollLeft=0}else view=new EditorView({state:makeState(text),parent:document.getElementById('editor')});buttons()}
function snapshot(){if(view.compositionStarted)throw Error('输入法仍在输入，未截取快照');lock(true);return {text:raw,revision,generation}}
async function sendSnapshot(request){
  // Never snapshot a stale state while mobile IME still owns a preedit. Blurring
  // asks WebKit to commit; if composition does not finish, host times out safely.
  const ticket=++snapshotEpoch
  if(view.compositionStarted){
    const ended=await new Promise(resolve=>{const dom=view.contentDOM;const finish=()=>{clearTimeout(timer);dom.removeEventListener('compositionend',finish);resolve(true)};const timer=setTimeout(()=>{dom.removeEventListener('compositionend',finish);resolve(false)},3000);dom.addEventListener('compositionend',finish,{once:true});dom.blur()})
    if(!ended)return
  }
  // compositionend/DOM observers can commit on the next task even when the
  // keyboard had already ended composition before native navigation began.
  await new Promise(resolve=>setTimeout(resolve,40))
  if(ticket!==snapshotEpoch||view.compositionStarted)return
  post('editorSnapshot',{...snapshot(),request})
}
window.nikkiEditor={setText,setTheme,snapshot,sendSnapshot,unlock:()=>{snapshotEpoch++;lock(false)},get view(){return view}}
function command(id,fn){const button=document.getElementById(id);button.addEventListener('pointerdown',e=>{if(id!=='find')e.preventDefault()});button.addEventListener('click',()=>{if(locked)return;fn(view);if(id!=='find')view.focus();buttons()})}
command('undo',undo);command('redo',redo);command('find',openSearchPanel);command('fold',foldAll);command('unfold',unfoldAll)
Promise.resolve(post('editorReady',{generation:window.__nikkiGeneration})).then(initial=>{if(!initial||initial.generation!==window.__nikkiGeneration)return;setText(initial.text,initial.generation,initial.theme);post('editorInitialized',{generation:initial.generation})}).catch(()=>post('editorInitError',{generation:window.__nikkiGeneration}))
