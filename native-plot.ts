// Pure geometry/drawing port of plot-canvas.ts. Coordinates are native points, not DPR pixels.
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
export function drawNativeGrid(ctx:any,size:{width:number;height:number}){
  const w=size.width,h=size.height
  ctx.strokeStyle='rgba(146,149,163,0.22)';ctx.lineWidth=.6;ctx.setLineDash([3,3]);ctx.beginPath()
  for(let i=0;i<8;i++){ctx.moveTo(i*w/7,0);ctx.lineTo(i*w/7,h)}
  for(let i=0;i<5;i++){ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4)}
  ctx.stroke();ctx.setLineDash([])
}
export function drawNativePlot(ctx:any,size:{width:number;height:number},s:NativePlotModel,background:string){
  const w=size.width,h=size.height;if(w<=0||h<=0)return
  // Canvas supplies a fresh context in point coordinates. No Web DPR transform or opaque clearRect.
  ctx.fillStyle=background;ctx.fillRect(0,0,w,h);drawNativeGrid(ctx,size)
  if(s.history.length<2||s.shown.length<2)return
  const y=(v:number)=>h-2-v/s.scale*(h-4)
  const path=()=>{ctx.beginPath();ctx.moveTo(s.shown[0].x*w,y(s.shown[0].y));for(let i=1;i<s.shown.length;i++){const a=s.shown[i-1],b=s.shown[i],m=(a.x+b.x)*w/2;ctx.bezierCurveTo(m,y(a.y),m,y(b.y),b.x*w,y(b.y))}}
  path()
  if(s.config.area){ctx.save();ctx.lineTo(s.shown[s.shown.length-1].x*w,h);ctx.lineTo(s.shown[0].x*w,h);ctx.closePath();ctx.fillStyle=s.config.tone;ctx.globalAlpha=.1;ctx.fill();ctx.restore();path()}
  ctx.strokeStyle=s.config.tone;ctx.lineWidth=1.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()
}
