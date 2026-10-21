// Executes the actual bundled CodeMirror document in jsdom. This is NOT WebKit,
// native navigation, keyboard geometry or font/layout validation. Browser tests
// additionally exercise the same document with a real Chromium DOM.
const path=require('node:path')
const {JSDOM}=require(process.env.JSDOM_PATH||path.join(__dirname,'../editor/node_modules/jsdom'))
class MockWebViewController {
  constructor(options){this.options=options;this.handlers={};this.disposed=false;this.pendingMessages=[];this.deferMessages=false;this.loads=0;this.loadMode=MockWebViewController.loadMode;this.initialization=MockWebViewController.initialization}
  async addScriptMessageHandler(name,fn){this.handlers[name]=fn}
  async loadHTML(html){
    this.loads++;this.html=html;this.dom?.window.close()
    const dom=this.dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true}),window=dom.window,document=window.document
    window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}})
    window.ResizeObserver=class{observe(){}unobserve(){}disconnect(){}}
    window.Range.prototype.getClientRects=()=>[]
    window.Range.prototype.getBoundingClientRect=()=>({top:0,bottom:0,left:0,right:0,width:0,height:0})
    window.webkit={messageHandlers:new Proxy({}, {get:(_target,name)=>({postMessage:message=>{if(name==='editorReady'&&this.initialization==='silent')return undefined;if(this.deferMessages&&name==='editorChanged'){this.pendingMessages.push([name,message]);return}return this.handlers[name]?.(message)}})})}
    // Compatibility adapter for existing bridge/recovery tests, not a replacement
    // editor: all state and changes below use the real CodeMirror EditorView.
    const body={get value(){return window.nikkiEditor?.view?.state.doc.toString()??''},get readOnly(){return window.nikkiEditor?.view?.state.readOnly??true},selectionStart:0,selectionEnd:0}
    this.page={document,window,elements:{body}};this.vm=window
    const script=document.querySelector('script').textContent
    this.runDocument=()=>window.eval(script)
    if(this.loadMode==='beforeDocument')return true
    this.runDocument()
    if(this.loadMode==='pendingAfterDocument')return new Promise(()=>{})
    return true
  }
  async evaluateJavaScript(code){if(this.disposed||!this.vm)throw Error('no local document');return this.vm.eval(this.evaluationMode==='expression'?code:'(function(){'+code+'\n})()')}
  input(text){const view=this.page.window.nikkiEditor?.view;if(!view||view.state.readOnly)return false;const before=view.state.doc.toString(),after=String(text).replace(/\r\n|\r/g,'\n');let start=0,end=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;view.dispatch({changes:{from:start,to:before.length-end,insert:after.slice(start,after.length-end)},userEvent:'input'});return true}
  scroll(top,left=0){const view=this.page.window.nikkiEditor.view;view.scrollDOM.scrollTop=top;view.scrollDOM.scrollLeft=left;view.scrollDOM.dispatchEvent(new this.vm.Event('scroll'))}
  flushMessages(){for(const [name,message] of this.pendingMessages.splice(0))this.handlers[name]?.(message)}
  dispose(){this.disposed=true;this.page=null;this.vm=null;this.dom?.window.close();this.dom=null}
}
module.exports={MockWebViewController}
