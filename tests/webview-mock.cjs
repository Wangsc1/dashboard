// Executes the actual embedded editor JavaScript against a small DOM model.
// This validates events/data/scroll offsets, NOT WKWebView/iPhone layout or font metrics.
const vm = require('node:vm')
class Element {
  constructor(textarea=false) { this.textarea=textarea;this._value='';this.textContent='';this.style={};this.listeners={};this.scrollTop=0;this.scrollLeft=0;this.readOnly=false;this.selectionStart=0;this.selectionEnd=0 }
  get value(){return this._value}
  set value(v){this._value=this.textarea?String(v).replace(/\r\n|\r/g,'\n'):String(v)}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}
  dispatch(name,event={}){for(const fn of this.listeners[name]??[])fn(event)}
  setRangeText(text,start,end){this.value=this.value.slice(0,start)+text+this.value.slice(end);this.selectionStart=this.selectionEnd=start+text.length}
}
class MockWebViewController {
  constructor(options){this.options=options;this.handlers={};this.disposed=false;this.pendingMessages=[];this.deferMessages=false;this.loads=0;this.loadMode=MockWebViewController.loadMode;this.initialization=MockWebViewController.initialization}
  async addScriptMessageHandler(name,fn){this.handlers[name]=fn}
  async loadHTML(html){
    this.loads++;this.html=html
    const elements={body:new Element(true),numbers:new Element(),gutter:new Element()}
    const document={getElementById:id=>elements[id],documentElement:{dataset:{}}}
    const window={webkit:{messageHandlers:new Proxy({}, {get:(_target,name)=>({postMessage:message=>{if(name==='editorReady'&&this.initialization==='silent')return undefined;if(this.deferMessages&&name==='editorChanged'){this.pendingMessages.push([name,message]);return}return this.handlers[name]?.(message)}})})}}
    this.page={document,window,elements};this.vm=vm.createContext({document,window})
    const script=html.match(/<script>([\s\S]*?)<\/script>/)[1]
    this.runDocument=()=>vm.runInContext(script,this.vm)
    if(this.loadMode==='beforeDocument')return true
    this.runDocument()
    if(this.loadMode==='pendingAfterDocument')return new Promise(()=>{})
    return true
  }
  async evaluateJavaScript(code){if(this.disposed||!this.vm)throw Error('no local document');return vm.runInContext(this.evaluationMode==='expression'?code:'(function(){'+code+'\n})()',this.vm)}
  input(text){const el=this.page.elements.body;if(el.readOnly)return false;el.value=text;el.dispatch('input');return true}
  scroll(top,left=0){const el=this.page.elements.body;el.scrollTop=top;el.scrollLeft=left;el.dispatch('scroll')}
  flushMessages(){for(const [name,message] of this.pendingMessages.splice(0))this.handlers[name]?.(message)}
  dispose(){this.disposed=true;this.page=null;this.vm=null}
}
module.exports={MockWebViewController}
