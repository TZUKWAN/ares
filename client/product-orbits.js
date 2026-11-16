/** Decorative technology tracks; no task, agent or completion state is generated. */
import {productRadius} from './product-geometry.js';
import {transform} from './forge-geometry.js';
const TAU=Math.PI*2;
const rings=[{radius:1.35,tilt:[1.02,0,.12],phase:.35,speed:.34},{radius:1.42,tilt:[.75,.55,-.9],phase:1.15,speed:-.26},{radius:1.23,tilt:[.4,1.1,.8],phase:4.5,speed:.29}];
function rotate(point,angles){let [x,y,z]=point;const [a,b,c]=angles,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b),sb=Math.sin(b),cc=Math.cos(c),sc=Math.sin(c);[y,z]=[y*ca-z*sa,y*sa+z*ca];[x,z]=[x*cb+z*sb,-x*sb+z*cb];return [x*cc-y*sc,x*sc+y*cc,z];}
function world(spec,angle){return rotate([Math.cos(angle)*spec.radius,Math.sin(angle)*spec.radius,0],spec.tilt);}
const paths=rings.map(spec=>Array.from({length:161},(_,i)=>world(spec,i/160*TAU)));
export function drawProductOrbits(ctx,node,time,view){
 const radius=productRadius(node.scale),cx=node.x,cy=node.y;
 function project(point){const p=transform(view,point),k=1/(1-p[2]*.12),x=p[0]*radius*k,y=-p[1]*radius*k,hidden=p[2]<0&&Math.hypot(x,y)<radius*1.015;let alpha=hidden?0:p[2]<0?.42:1;if(y>radius*.96&&Math.abs(x)<radius*.8)alpha*=Math.max(0,Math.min(1,(Math.abs(x)-radius*.6)/(radius*.2)));return {x:cx+x,y:cy+y,alpha};}
 let trackCount=0,headCount=0,ticks=0;ctx.save();ctx.globalCompositeOperation='lighter';ctx.lineCap='round';ctx.lineJoin='round';
 for(let index=0;index<rings.length;index++){
  const spec=rings[index],points=paths[index].map(project);ctx.shadowBlur=0;ctx.lineWidth=.7;ctx.strokeStyle='rgba(83,180,223,.17)';ctx.beginPath();let active=false;for(const point of points){if(!point.alpha){active=false;continue;}if(!active){ctx.moveTo(point.x,point.y);active=true;}else ctx.lineTo(point.x,point.y);}ctx.stroke();trackCount++;
  for(let head=0;head<2;head++){
   const lead=spec.phase+time*spec.speed+head*Math.PI,tailLength=.75,direction=Math.sign(spec.speed),strength=head?.52:1,trail=Array.from({length:19},(_,i)=>project(world(spec,lead-direction*tailLength*i/18)));
   for(let i=trail.length-2;i>=0;i--){const a=trail[i],b=trail[i+1],fade=Math.pow(1-i/(trail.length-1),1.8),alpha=Math.min(a.alpha,b.alpha)*fade*strength;if(alpha<.012)continue;ctx.strokeStyle=`rgba(119,226,255,${alpha*.7})`;ctx.lineWidth=1.15;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
   const point=trail[0];if(point.alpha>.01){const size=Math.max(3,Math.min(6,radius*.034)),glow=ctx.createRadialGradient(point.x,point.y,0,point.x,point.y,size*1.8);glow.addColorStop(0,`rgba(223,250,255,${point.alpha*strength*.95})`);glow.addColorStop(.24,`rgba(112,229,255,${point.alpha*strength*.72})`);glow.addColorStop(1,'rgba(60,160,244,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.arc(point.x,point.y,size*1.8,0,TAU);ctx.fill();headCount++;}
  }
 }
 // Open arcs and sparse calibration marks leave room below for the work label.
 ctx.shadowBlur=0;ctx.lineWidth=.8;ctx.strokeStyle='rgba(94,189,229,.27)';ctx.setLineDash([22,10,3,10]);ctx.lineDashOffset=-time*7;
 for(const [start,end]of [[1.03,1.42],[1.58,1.98],[.72,.94],[.06,.28]]){ctx.beginPath();ctx.arc(cx,cy,radius*1.2,start*Math.PI,end*Math.PI);ctx.stroke();}ctx.setLineDash([]);
 ctx.strokeStyle='rgba(138,210,239,.28)';ctx.lineWidth=.7;ctx.beginPath();for(let i=0;i<36;i++){const a=i/36*TAU;if(a>Math.PI*.32&&a<Math.PI*.68)continue;const inner=radius*1.3,outer=radius*(i%6===0?1.38:1.33);ctx.moveTo(cx+Math.cos(a)*inner,cy+Math.sin(a)*inner);ctx.lineTo(cx+Math.cos(a)*outer,cy+Math.sin(a)*outer);ticks++;}ctx.stroke();ctx.restore();return {tracks:trackCount,heads:headCount,ticks};
}
