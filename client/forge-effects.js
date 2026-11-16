import {visualRandom,TAU} from './forge-geometry.js?v=2.3.0-forge-faithful';
import {clamp} from './forge-timeline.js?v=2.3.0-forge-faithful';
const rgba=(hex,alpha)=>{const n=parseInt(hex.slice(1),16);return `rgba(${n>>16&255},${n>>8&255},${n&255},${alpha})`;};
function cubic(points,t){const u=1-t;return [u*u*u*points[0]+3*u*u*t*points[2]+3*u*t*t*points[4]+t*t*t*points[6],u*u*u*points[1]+3*u*u*t*points[3]+3*u*t*t*points[5]+t*t*t*points[7]];}
function approximateLength(points){let sum=0,last=[points[0],points[1]];for(let i=1;i<=12;i++){const p=cubic(points,i/12);sum+=Math.hypot(p[0]-last[0],p[1]-last[1]);last=p;}return sum;}
function curve(a,b,fields){const first=approximateLength(a),second=b?approximateLength(b):0;return {a,b,fraction:first/(first+second||1),...fields};}
function curvePoint(path,t){return !path.b?cubic(path.a,t):t<path.fraction?cubic(path.a,t/path.fraction):cubic(path.b,(t-path.fraction)/(1-path.fraction));}
function strokePath(ctx,path){ctx.moveTo(path.a[0],path.a[1]);ctx.bezierCurveTo(...path.a.slice(2));if(path.b)ctx.bezierCurveTo(...path.b.slice(2));}

/** Cached bus geometry and explicitly visual transport. No business counters. */
export function createForgeEffects(canvas){
 const ctx=canvas.getContext('2d'),background=document.createElement('canvas'),paper=background.getContext('2d'),random=visualRandom(77);
 let layout,inputs=[],outputs=[],deliveries=[],busLeft,busRight,packets=[],waiting=[],embers=[],flashes=[],ripples=[],accumulator=0,clock=0,inputAcc=[],outputAcc=[],deliveryAcc=0,sourceRows=[],partRows=[];
 function build(next,sources,parts){
  layout=next;sourceRows=sources;partRows=parts;canvas.width=background.width=Math.max(2,Math.round(next.width*next.dpr));canvas.height=background.height=Math.max(2,Math.round(next.height*next.dpr));inputs=[];outputs=[];deliveries=[];busLeft=null;busRight=null;reset();
  const {cx,cy,scale:S,boardScale:bs,stage}=next,radius=S*.42,channels=[];
  if(!next.compact){
   busLeft={x:next.left.x+next.left.w+34*bs,y0:stage.y+stage.h*.25,y1:stage.y+stage.h*.83,label:'STATE IN'};
   for(let i=0;i<sources.length;i++)for(let k=0;k<44;k++){
    const box=sources[i].box,px=box.x+box.w+5*bs,py=box.y+box.h*.5+(k/43-.5)*box.h*.62,bx=busLeft.x,by=busLeft.y0+(k*sources.length+i)/Math.max(1,sources.length*44-1)*(busLeft.y1-busLeft.y0),angle=Math.PI*(.62+.76*random()),r=radius*(2+random()*.7),ex=cx+Math.cos(angle)*r,ey=cy+Math.sin(angle)*r,tx=Math.abs(-Math.sin(angle))+.12,ty=Math.cos(angle)*(ey>by?1:-1);
    inputs.push(curve([px,py,px+(bx-px)*.5,py,bx-(bx-px)*.5,by,bx,by],[bx,by,bx+(ex-bx)*.42,by,ex-tx*r*.35,ey-ty*r*.35,ex,ey],{source:i,color:sources[i].color}));
   }
   busRight={x:next.right.x-34*bs,y0:stage.y+stage.h*.15,y1:stage.y+stage.h*.86,label:'DISPATCH OUT'};const split=busRight.y0+(busRight.y1-busRight.y0)*.72;
   for(let i=0;i<parts.length;i++)for(let k=0;k<18;k++){
    const box=parts[i].box,x=next.right.x-1,y=box.y+box.h*.5+(k/17-.5)*box.h*.62,bx=busRight.x,by=busRight.y0+(k*parts.length+i)/Math.max(1,parts.length*18-1)*(split-busRight.y0),a=Math.PI*(-.38+.76*random()),r=radius*(2+random()*.7),sx=cx+Math.cos(a)*r,sy=cy+Math.sin(a)*r,tx=Math.abs(Math.sin(a))+.12,ty=Math.cos(a)*(by>sy?1:-1);
    outputs.push(curve([sx,sy,sx+tx*r*.35,sy+ty*r*.35,bx-(bx-sx)*.42,by,bx,by],[bx,by,bx+(x-bx)*.5,by,x-(x-bx)*.5,y,x,y],{part:i,color:parts[i].color}));
   }
   for(let k=0;k<24;k++){
    const box=next.records,bx=busRight.x,by=split+8*bs+random()*Math.max(1,busRight.y1-split-8*bs),x=box.x-1,y=box.y+30*bs+random()*Math.max(10,box.h-44*bs),a=Math.PI*(-.1+.45*random()),r=radius*(2+random()*.7),sx=cx+Math.cos(a)*r,sy=cy+Math.sin(a)*r;
    deliveries.push(curve([sx,sy,sx+r*.25,sy+r*.1,bx-(bx-sx)*.42,by,bx,by],[bx,by,bx+(x-bx)*.5,by,x-(x-bx)*.5,y,x,y],{color:'#ffb36b'}));
   }
  }else{
   for(let i=0;i<sources.length;i++)for(let k=0;k<16;k++){const side=i%2?1:-1,x=side<0?2:next.width-2,y=stage.y+stage.h*(.12+random()*.76),a=side<0?Math.PI*(.6+.8*random()):Math.PI*(-.4+.8*random()),r=radius*(1.08+random()*.45),ex=cx+Math.cos(a)*r,ey=cy+Math.sin(a)*r;inputs.push(curve([x,y,x+(ex-x)*.5,y,ex+Math.sin(a)*r*.7,ey-Math.cos(a)*r*.7,ex,ey],null,{source:i,color:sources[i].color}));}
  }
  paintBackground();return stats();
 }
 function bus(c,b,count){if(!b)return;const bs=Math.max(.6,layout.boardScale),height=b.y1-b.y0;c.fillStyle='rgba(6,8,11,.88)';c.fillRect(b.x-5*bs,b.y0-6,10*bs,height+12);c.strokeStyle='rgba(170,200,235,.32)';c.lineWidth=1;c.strokeRect(b.x-5*bs+.5,b.y0-5.5,10*bs-1,height+11);const steps=Math.floor(height/(5*bs));for(let i=0;i<=steps;i++){c.fillStyle=i%8===0?'rgba(200,220,245,.55)':'rgba(170,200,235,.22)';c.fillRect(b.x-3*bs,b.y0+i/Math.max(1,steps)*height,(i%8===0?6:4)*bs,1);}c.font=`500 ${Math.round(8.5*bs)}px "ARES Forge Mono",monospace`;c.textAlign='center';c.fillStyle='rgba(170,190,215,.65)';c.fillText(b.label,b.x,b.y0-14*bs);c.fillStyle='rgba(120,135,155,.6)';c.fillText(count+' CH',b.x,b.y1+20*bs);}
 function paintBackground(){
  const c=paper;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,background.width,background.height);c.setTransform(layout.dpr,0,0,layout.dpr,0,0);c.globalCompositeOperation='lighter';c.lineWidth=.6;
  for(const [paths,incoming]of [[inputs,true],[outputs,false]])for(const path of paths){const start=path.a,end=path.b||path.a,gradient=c.createLinearGradient(start[0],start[1],end[6],end[7]);gradient.addColorStop(0,rgba(path.color,incoming?.24:.05));gradient.addColorStop(.45,rgba(path.color,.10));gradient.addColorStop(1,incoming?'rgba(215,228,245,.06)':rgba(path.color,.28));c.strokeStyle=gradient;c.beginPath();strokePath(c,path);c.stroke();}
  c.strokeStyle='rgba(255,190,130,.07)';deliveries.forEach(path=>{c.beginPath();strokePath(c,path);c.stroke();});c.globalCompositeOperation='source-over';bus(c,busLeft,inputs.length);bus(c,busRight,outputs.length+deliveries.length);
 }
 function reset(){packets=[];waiting=[];embers=[];flashes=[];ripples=[];accumulator=0;clock=0;inputAcc=sourceRows.map(()=>0);outputAcc=partRows.map(()=>0);deliveryAcc=0;}
 function addPacket(path,kind,color=path?.color,hot=false){if(!path)return;packets.push({path,kind,color,hot,t:0,speed:(kind===0?.3:.42)+random()*.22,flashed:false});}
 function advance(dt,state,enabled){
  clock+=dt;if(enabled&&dt>0){const multiplier=layout.compact?.5:1;
   for(let i=0;i<sourceRows.length;i++){const owner=state.active>=0&&partRows[state.active]?.source===i,rate=state.phase==='ingest'?14:state.phase==='collapse'?9:state.phase==='build'?(owner?18:4.5):['form','split','assemble'].includes(state.phase)?6:4.5;inputAcc[i]=(inputAcc[i]||0)+dt*rate*multiplier;while(inputAcc[i]>=1){inputAcc[i]--;const pool=inputs.filter(path=>path.source===i);addPacket(pool[Math.floor(random()*pool.length)],0);}}
   partRows.forEach((part,i)=>{const hot=state.phase==='build'&&state.active===i,rate=hot?7:['build','assemble'].includes(state.phase)?1:.6;outputAcc[i]=(outputAcc[i]||0)+dt*rate*multiplier;while(outputAcc[i]>=1){outputAcc[i]--;const pool=outputs.filter(path=>path.part===i);addPacket(pool[Math.floor(random()*pool.length)],1,part.color,hot);}});
   deliveryAcc+=dt*(state.phase==='deliver'?16:1.2)*multiplier;while(deliveryAcc>=1){deliveryAcc--;addPacket(deliveries[Math.floor(random()*deliveries.length)],2,'#ffb36b',true);}
  }
  for(let i=waiting.length-1;i>=0;i--){const entry=waiting[i];entry.left-=dt;if(entry.left<=0){waiting.splice(i,1);const pool=state.phase==='deliver'&&random()<.75?deliveries:outputs;addPacket(pool[Math.floor(random()*pool.length)],pool===deliveries?2:1,entry.color,true);}}
  for(let i=packets.length-1;i>=0;i--){const p=packets[i];p.t+=dt*p.speed*(p.kind===0?.62+p.t*1.1:1.2-p.t*.45);if(!p.flashed&&p.path.b&&p.t>=p.path.fraction){p.flashed=true;flashes.push({x:p.path.a[6],y:p.path.a[7],life:0,color:p.color,big:p.kind!==0});}if(p.t>=1){packets.splice(i,1);const end=curvePoint(p.path,1);if(p.kind===0){if(waiting.length<260&&random()<.62)waiting.push({left:.35+random()*.45,color:p.color});}else ripples.push({x:end[0],y:end[1],life:0,color:p.color,big:p.hot});}}
  packets=packets.slice(-1400);flashes=flashes.filter(value=>(value.life+=dt/.45)<1).slice(-220);ripples=ripples.filter(value=>(value.life+=dt/(value.big?.8:.6))<1).slice(-140);embers=embers.filter(value=>{value.life+=dt/.55;value.x+=value.vx*dt;value.y+=value.vy*dt;return value.life<1;}).slice(-420);
 }
 function draw({time,dt,state,enabled=true,labels=[],focus=-1,zoom=1}){
  if(!layout)return;advance(dt,state,enabled);const c=ctx,dpr=layout.dpr,bs=Math.max(.7,layout.boardScale),S=layout.scale*zoom;
  c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(background,0,0);c.setTransform(dpr,0,0,dpr,0,0);
  c.lineWidth=1;const rotation=time*.05,r=S*1.3;
  for(let i=0;i<120;i++){const a=i/120*TAU+rotation,l=(i%10===0?7:3)*bs;c.strokeStyle=i%10===0?'rgba(170,200,235,.22)':'rgba(170,200,235,.09)';c.beginPath();c.moveTo(layout.cx+Math.cos(a)*r,layout.cy+Math.sin(a)*r);c.lineTo(layout.cx+Math.cos(a)*(r+l),layout.cy+Math.sin(a)*(r+l));c.stroke();}
  c.strokeStyle='rgba(156,208,255,.28)';for(let i=0;i<3;i++){const a=-rotation*1.6+i*TAU/3;c.beginPath();c.arc(layout.cx,layout.cy,r-5*bs,a,a+.32);c.stroke();}
  if(!layout.compact){const extent=S*2.05,length=14*bs;c.strokeStyle='rgba(170,200,235,.18)';for(const [sx,sy]of [[-1,-1],[1,-1],[1,1],[-1,1]]){const x=layout.cx+sx*extent,y=layout.cy+sy*extent*.82;c.beginPath();c.moveTo(x,y-sy*length);c.lineTo(x,y);c.lineTo(x-sx*length,y);c.stroke();}}
  c.globalCompositeOperation='lighter';c.lineCap='round';
  for(const p of packets){const path=p.path,t=p.t,head=curvePoint(path,t),tail=curvePoint(path,Math.max(0,t-(p.kind===0?.05:.095))),fade=Math.min(1,t*8)*Math.min(1,(1-t)*10);if(p.kind!==0){c.strokeStyle=rgba(p.color,.13*fade);c.lineWidth=5*bs;c.beginPath();c.moveTo(...tail);c.lineTo(...head);c.stroke();}c.strokeStyle=rgba(p.color,(p.kind===0?.5:.8)*fade);c.lineWidth=p.kind===0?1:1.5*bs;c.beginPath();c.moveTo(...tail);c.lineTo(...head);c.stroke();c.fillStyle=`rgba(240,246,255,${.9*fade})`;c.fillRect(head[0]-1,head[1]-1,2,2);if(p.kind!==0&&dt>0&&random()<.22&&embers.length<420)embers.push({x:head[0],y:head[1],vx:(random()-.5)*14,vy:(random()-.5)*14,life:0,color:p.color});}
  for(const ember of embers){c.fillStyle=rgba(ember.color,.7*(1-ember.life));c.fillRect(ember.x-.75,ember.y-.75,1.5,1.5);}
  for(const flash of flashes){const half=(flash.big?11:7)*bs;c.strokeStyle=rgba(flash.color,.9*(1-flash.life));c.lineWidth=1.5;c.beginPath();c.moveTo(flash.x-half,flash.y);c.lineTo(flash.x+half,flash.y);c.stroke();}
  for(const ripple of ripples){const size=(2+(ripple.big?20:12)*ripple.life)*bs;c.strokeStyle=rgba(ripple.color,.7*(1-ripple.life));c.lineWidth=1;c.beginPath();c.arc(ripple.x,ripple.y,size,0,TAU);c.stroke();c.fillStyle=rgba(ripple.color,.9*(1-ripple.life));c.fillRect(ripple.x-1,ripple.y-6*bs,2,12*bs);}
  c.globalCompositeOperation='source-over';
  if(!layout.compact)for(const label of labels){if(label.opacity<.01)continue;const hot=state.active===label.index&&state.phase==='build',opacity=label.opacity*(focus>=0&&focus!==label.index?.35:1);c.strokeStyle=hot?`rgba(255,173,94,${.85*opacity})`:`rgba(156,208,255,${.42*opacity})`;c.lineWidth=1;c.beginPath();c.moveTo(label.anchorX,label.anchorY);c.lineTo(label.edgeX+(label.right?-16:16)*bs,label.middleY);c.lineTo(label.edgeX,label.middleY);c.stroke();c.beginPath();c.arc(label.anchorX,label.anchorY,(hot?4:2.6)*bs,0,TAU);c.stroke();}
 }
 function stats(){return {inputs:inputs.length,outputs:outputs.length,deliveryChannels:deliveries.length,packets:packets.length,distilling:waiting.length,embers:embers.length};}
 return {build,draw,reset,stats,dispose(){reset();background.width=background.height=1;canvas.width=canvas.height=1;}};
}
