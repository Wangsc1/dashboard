// Official views/editor contract model, NOT the App's implementation or pixel validation.
// Fast mode is only a fixture. deferEdits models a dispatched native edit whose
// getter catches up with the debounced event; neither mode asserts SDK internals.
class MockEditorController {
  static instances=[];static clock=0
  constructor({content='',ext='txt',readOnly=false}={}){this._content=content;Object.defineProperty(this,'ext',{value:ext});this.readOnly=readOnly;this.disposed=false;this.disposeCount=0;this.past=[];this.future=[];this.selection=[0,0];this.changeAt=null;this.deferEdits=false;this.pendingNative=null;MockEditorController.instances.push(this)}
  check(){if(this.disposed)throw Error('disposed editor')}
  get content(){this.check();return this._content}
  set content(value){this.check();this._content=String(value)}
  input(value){this.check();if(this.readOnly)return;this.pendingNative=null;this.past.push(this._content);this.future=[];this._content=String(value);this.changeAt=MockEditorController.clock+100}
  static advance(ms){this.clock+=ms;for(const c of this.instances)if(!c.disposed&&c.changeAt!==null&&c.changeAt<=this.clock){c.changeAt=null;if(c.pendingNative!==null){c._content=c.pendingNative;c.pendingNative=null}c.onContentChanged?.(c.content)}}
  undo(){this.check();if(this.past.length){this.future.push(this._content);this._content=this.past.pop();this.changeAt=MockEditorController.clock+100}}
  redo(){this.check();if(this.future.length){this.past.push(this._content);this._content=this.future.pop();this.changeAt=MockEditorController.clock+100}}
  async searchText(query,{caseSensitive=false}={}){this.check();if(!query)return [];const text=caseSensitive?this.content:this.content.toLowerCase(),q=caseSensitive?query:query.toLowerCase(),out=[];for(let i=0;(i=text.indexOf(q,i))!==-1;i+=q.length)out.push({start:i,end:i+q.length,line:this.content.slice(0,i).split('\n').length});return out}
  setSelection(start,end){this.check();this.selection=[start,end]}
  replaceSelection(text){this.check();const [start,end]=this.selection,next=this.content.slice(0,start)+text+this.content.slice(end);if(this.deferEdits){this.past.push(this._content);this.future=[];this.pendingNative=next;this.changeAt=MockEditorController.clock+100}else this.input(next);this.selection=[start,start+text.length]}
  async getSelectedText(){this.check();return this.content.slice(...this.selection)}
  dispose(){if(this.disposed)throw Error('double dispose');this.disposed=true;this.disposeCount++;this.changeAt=null}
}
module.exports={MockEditorController}
