// Pure geometry/drawing for the native chart. Coordinates are native points, not DPR pixels.
export interface PlotPoint { x:number;y:number }
export interface NativePlotInput {samples:number[];tone:string;area:boolean;percent:boolean;running:boolean;sampleAt:number;resume?:boolean}
export interface NativePlotModel {
  config:NativePlotInput;history:number[];shown:PlotPoint[];from:PlotPoint[];to:PlotPoint[];
  scale:number;scaleFrom:number;scaleTo:number;start:number;duration:number;lastSampleAt:number;active:boolean;animating:boolean
}
export function canonicalPlot(values:number[]):PlotPoint[]{return values.map((v,i)=>({x:(60-values.length+i)/59,y:v}))}
export function createNativePlot():NativePlotModel {
  return {config:{samples:[],tone:'#3485eb',area:false,percent:true,running:false,sampleAt:0},history:[],shown:[],from:[],to:[],scale:100,scaleFrom:100,scaleTo:100,start:0,duration:1000,lastSampleAt:0,active:false,animating:false}
}
export function updateNativePlot(s:NativePlotModel,input:NativePlotInput,now:number){
  const sampleAt=Number(input.sampleAt)||0,observed=sampleAt>s.lastSampleAt&&s.lastSampleAt?sampleAt-s.lastSampleAt:1000
  const previous=s.config
  const values=input.samples.filter(Number.isFinite).slice(-60),target=canonicalPlot(values),old=s.history,wasActive=s.active
  const sameFrame=sampleAt===previous.sampleAt&&values.length===old.length&&values.every((v,i)=>v===old[i])&&input.percent===previous.percent
  s.config=input;s.active=input.running
  // running/theme changes can replay the retained snapshot on resume. They are not
  // samples: do not shift a full window or reintroduce its pre-background timestamp.
  if(sameFrame){if(input.resume||!s.active||!wasActive)restoreNativePlot(s);return}
  s.lastSampleAt=input.running?sampleAt:0
  s.animating=false;s.scaleTo=input.percent?100:Math.max(1024,...values)
  if(input.resume||!s.active||!wasActive||!s.shown.length||values.length<2||values.length<old.length){s.history=values;s.shown=target;s.scale=s.scaleTo;return}
  let origin=s.shown
  if(origin.length>60&&origin[0].x<0)origin=origin.slice(1)
  let goal=target
  if(old.length===60&&values.length===60)goal=[{x:-1/59,y:old[0]},...target]
  const n=Math.max(origin.length,goal.length)
  // from must not alias shown: the per-frame loop now reuses shown's point objects.
  s.from=Array.from({length:n},(_,i)=>{const p=origin[Math.min(i,origin.length-1)];return {x:p.x,y:p.y}})
  s.to=Array.from({length:n},(_,i)=>goal[Math.min(i,goal.length-1)])
  s.history=values;s.scaleFrom=s.scale;s.start=now;s.duration=Math.max(1000,Math.min(2500,observed))
  s.animating=s.scaleFrom!==s.scaleTo||s.from.some((p,i)=>p.x!==s.to[i].x||p.y!==s.to[i].y)
  // Allocate only at sample boundaries, never per native animation tick.
  s.shown.length=n
  for(let i=0;i<n;i++)if(!s.shown[i])s.shown[i]={x:s.from[i].x,y:s.from[i].y}
}
export function advanceNativePlot(s:NativePlotModel,now:number){
  if(!s.animating)return
  const p=Math.max(0,Math.min(1,(now-s.start)/s.duration))
  for(let i=0;i<s.from.length;i++){
    const a=s.from[i],b=s.to[i],out=s.shown[i]
    out.x=a.x+(b.x-a.x)*p;out.y=a.y+(b.y-a.y)*p
  }
  s.scale=s.scaleFrom+(s.scaleTo-s.scaleFrom)*p
  if(p>=1)s.animating=false
}
export function restoreNativePlot(s:NativePlotModel){s.animating=false;s.shown=canonicalPlot(s.history);s.scale=s.scaleTo;s.lastSampleAt=0}
function hexRgba(color:string,alpha:number):string {
  const m=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())
  if(!m)return color
  const h=m[1].length===3?m[1].split('').map(c=>c+c).join(''):m[1]
  return `rgba(${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)},${alpha})`
}
export function drawNativeGrid(ctx:any,size:{width:number;height:number}){
  const w=size.width,h=size.height
  ctx.strokeStyle='rgba(142,142,147,0.18)';ctx.lineWidth=.6;ctx.setLineDash([2,4]);ctx.beginPath()
  for(let i=1;i<4;i++){const gy=i*h/4;ctx.moveTo(0,gy);ctx.lineTo(w,gy)}
  ctx.stroke();ctx.setLineDash([])
  ctx.strokeStyle='rgba(142,142,147,0.12)';ctx.lineWidth=.5;ctx.beginPath()
  ctx.moveTo(0,h-.5);ctx.lineTo(w,h-.5);ctx.stroke()
}
export function drawNativePlot(ctx:any,size:{width:number;height:number},s:NativePlotModel,background:string){
  const w=size.width,h=size.height;if(w<=0||h<=0)return
  // Canvas supplies a fresh context in point coordinates. No Web DPR transform or opaque clearRect.
  ctx.fillStyle=background;ctx.fillRect(0,0,w,h);drawNativeGrid(ctx,size)
  if(s.history.length<2||s.shown.length<2)return
  const pad=5,plotW=Math.max(1,w-5)
  const px=(x:number)=>x*plotW
  const py=(v:number)=>h-pad-v/s.scale*(h-pad*2)
  const path=()=>{ctx.beginPath();ctx.moveTo(px(s.shown[0].x),py(s.shown[0].y));for(let i=1;i<s.shown.length;i++){const a=s.shown[i-1],b=s.shown[i],m=(px(a.x)+px(b.x))/2;ctx.bezierCurveTo(m,py(a.y),m,py(b.y),px(b.x),py(b.y))}}
  path()
  if(s.config.area){
    ctx.save();ctx.lineTo(px(s.shown[s.shown.length-1].x),h-1);ctx.lineTo(px(s.shown[0].x),h-1);ctx.closePath()
    const grad=typeof ctx.createLinearGradient==='function'?ctx.createLinearGradient(0,0,0,h):null
    if(grad&&typeof grad.addColorStop==='function'){
      grad.addColorStop(0,hexRgba(s.config.tone,.24))
      grad.addColorStop(.75,hexRgba(s.config.tone,.05))
      grad.addColorStop(1,hexRgba(s.config.tone,0))
      ctx.fillStyle=grad
    }else{ctx.fillStyle=s.config.tone;ctx.globalAlpha=.12}
    ctx.fill();ctx.restore();path()
  }
  ctx.strokeStyle=s.config.tone;ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()
  const last=s.shown[s.shown.length-1],lx=px(last.x),ly=py(last.y)
  ctx.save()
  ctx.beginPath();ctx.arc(lx,ly,4.2,0,Math.PI*2);ctx.fillStyle=hexRgba(s.config.tone,.22);ctx.fill()
  ctx.beginPath();ctx.arc(lx,ly,2.3,0,Math.PI*2);ctx.fillStyle=s.config.tone;ctx.fill()
  ctx.restore()
}
