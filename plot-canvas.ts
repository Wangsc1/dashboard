// Inline-only chart runtime. No fetch, URLs, credentials or per-frame native bridge calls.
export function plotCanvasHTML() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#f2f2f7} @media(prefers-color-scheme:dark){html,body{background:#1c1c1e}}canvas{display:block;width:100%;height:100%;pointer-events:none}</style></head><body><canvas></canvas><script>
(function(){
'use strict';
const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');
let config={tone:'#3485eb',area:false,percent:true},history=[],from=[],to=[],shown=[],scale=100,scaleFrom=100,scaleTo=100,start=0,duration=1000,raf=0,seq=-1,active=false;
const stats={frames:0,updates:0,liveLoops:0};
function mix(a,b,p){return a+(b-a)*p}
function canonical(values){return values.map((v,i)=>({x:(60-values.length+i)/59,y:v}))}
function paint(){
 const r=canvas.getBoundingClientRect(),d=Math.min(3,window.devicePixelRatio||1),w=r.width,h=r.height;
 if(!w||!h)return;
 const cw=Math.round(w*d),ch=Math.round(h*d);if(canvas.width!==cw||canvas.height!==ch){canvas.width=cw;canvas.height=ch}
 ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);ctx.strokeStyle='rgba(146,149,163,.22)';ctx.lineWidth=.6;ctx.setLineDash([3,3]);ctx.beginPath();
 for(let i=0;i<8;i++){ctx.moveTo(i*w/7,0);ctx.lineTo(i*w/7,h)}for(let i=0;i<5;i++){ctx.moveTo(0,i*h/4);ctx.lineTo(w,i*h/4)}ctx.stroke();ctx.setLineDash([]);
 if(history.length<2||shown.length<2)return;
 const y=v=>h-2-v/scale*(h-4);ctx.beginPath();ctx.moveTo(shown[0].x*w,y(shown[0].y));
 for(let i=1;i<shown.length;i++){const a=shown[i-1],b=shown[i],m=(a.x+b.x)*w/2;ctx.bezierCurveTo(m,y(a.y),m,y(b.y),b.x*w,y(b.y))}
 if(config.area){ctx.save();ctx.lineTo(shown[shown.length-1].x*w,h);ctx.lineTo(shown[0].x*w,h);ctx.closePath();ctx.fillStyle=config.tone;ctx.globalAlpha=.1;ctx.fill();ctx.restore();ctx.beginPath();ctx.moveTo(shown[0].x*w,y(shown[0].y));for(let i=1;i<shown.length;i++){const a=shown[i-1],b=shown[i],m=(a.x+b.x)*w/2;ctx.bezierCurveTo(m,y(a.y),m,y(b.y),b.x*w,y(b.y))}}
 ctx.strokeStyle=config.tone;ctx.lineWidth=1.5;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();stats.frames++;
}
function stop(){if(raf)cancelAnimationFrame(raf);raf=0;stats.liveLoops=0}
function frame(at){raf=0;const p=Math.max(0,Math.min(1,(at-start)/duration));shown=from.map((a,i)=>({x:mix(a.x,to[i].x,p),y:mix(a.y,to[i].y,p)}));scale=mix(scaleFrom,scaleTo,p);paint();if(p<1&&active&&!document.hidden){raf=requestAnimationFrame(frame);stats.liveLoops=1}else stats.liveLoops=0}
window.plotCanvas={
 update(message){if(!message||message.seq<=seq)return false;seq=message.seq;stats.updates++;config=message;document.body.style.background=message.background||'#f2f2f7';
 const values=(message.samples||[]).filter(Number.isFinite).slice(-60),target=canonical(values),oldHistory=history;
 stop();active=!!message.running;scaleTo=message.percent?100:Math.max(1024,...values);
 if(!active||!shown.length||values.length<2||values.length<oldHistory.length){history=values;shown=target;scale=scaleTo;paint();return true}
 // Use the last actually painted geometry on interrupted samples. Never jump to an unfinished target.
 let origin=shown;
 if(origin.length>60&&origin[0].x<0)origin=origin.slice(1);
 let goal=target;
 if(oldHistory.length===60&&values.length===60)goal=[{x:-1/59,y:oldHistory[0]},...target];
 const n=Math.max(origin.length,goal.length);from=Array.from({length:n},(_,i)=>origin[Math.min(i,origin.length-1)]);to=Array.from({length:n},(_,i)=>goal[Math.min(i,goal.length-1)]);
 history=values;scaleFrom=scale;start=performance.now();duration=1000;raf=requestAnimationFrame(frame);stats.liveLoops=1;return true;
 },pause(){active=false;stop()},inspect(){return {seq,stats:{...stats},shown:shown.map(p=>({...p})),history:history.slice(),scale}}};
 new ResizeObserver(paint).observe(canvas);document.addEventListener('visibilitychange',()=>{if(document.hidden){active=false;stop()}});window.addEventListener('pagehide',stop);
 Promise.resolve(window.webkit.messageHandlers.plotReady.postMessage(null)).catch(()=>{});
})();
</script></body></html>`
}
