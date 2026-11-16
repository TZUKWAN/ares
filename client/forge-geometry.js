/** Procedural wire geometry for FORGE. All samples are visual coordinates only. */
export const TAU=Math.PI*2;
export const FORMS=[['humanoid','HUMANOID','人形机器人'],['engine','PROPULSION','推进单元'],['line','ASSEMBLY LINE','工业产线'],['city','SITE PLAN','园区工程'],['gear','PLANETARY','行星减速器'],['arm','6-AXIS ARM','机械臂']];
// Standard Mulberry32, used only to make decorative point/line sampling reproducible.
export function visualRandom(seed=1){let state=seed|0;return()=>{state=(state+0x6D2B79F5)|0;let value=Math.imul(state^(state>>>15),state|1);value^=value+Math.imul(value^(value>>>7),value|61);return ((value^(value>>>14))>>>0)/4294967296;};}
export const add=(a,b)=>a.map((value,index)=>value+b[index]);
export const scale=(a,factor)=>a.map(value=>value*factor);
export const subtract=(a,b)=>a.map((value,index)=>value-b[index]);
const length=a=>Math.hypot(...a);
const normalize=a=>scale(a,1/(length(a)||1));
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export function rotateX(a){const c=Math.cos(a),s=Math.sin(a);return [1,0,0,0,c,s,0,-s,c];}
export function rotateY(a){const c=Math.cos(a),s=Math.sin(a);return [c,0,-s,0,1,0,s,0,c];}
export function rotateZ(a){const c=Math.cos(a),s=Math.sin(a);return [c,s,0,-s,c,0,0,0,1];}
export function multiply(a,b){const out=new Array(9).fill(0);for(let c=0;c<3;c++)for(let r=0;r<3;r++)for(let k=0;k<3;k++)out[c*3+r]+=a[k*3+r]*b[c*3+k];return out;}
export function transform(m,p){return [0,1,2].map(row=>m[row]*p[0]+m[3+row]*p[1]+m[6+row]*p[2]);}
function axes(direction){const z=normalize(direction),x=normalize(cross(Math.abs(z[1])>.9?[1,0,0]:[0,1,0],z)),y=cross(z,x);return {x,y,z};}
const point=(c,a,x,y,z)=>add(c,add(scale(a.x,x),add(scale(a.y,y),scale(a.z,z))));

class WirePart{
 constructor(name,offset=[0,0,0],weight=1,spin=0){Object.assign(this,{name,offset,weight,spin,segments:[]});}
 segment(a,b){if(length(subtract(a,b))>1e-7)this.segments.push([a,b]);return this;}
 chain(points,closed=false){for(let i=1;i<points.length;i++)this.segment(points[i-1],points[i]);if(closed)this.segment(points.at(-1),points[0]);return this;}
 ring(center,radius,axis=[0,1,0],segments=64){const a=axes(axis),points=[];for(let i=0;i<segments;i++){const t=i/segments*TAU;points.push(point(center,a,Math.cos(t)*radius,Math.sin(t)*radius,0));}return this.chain(points,true);}
 cylinder(center,radius,height,axis=[0,1,0],rings=4,meridians=16){const a=axes(axis);for(let k=0;k<rings;k++)this.ring(add(center,scale(a.z,height*(k/Math.max(1,rings-1)-.5))),radius,axis);for(let i=0;i<meridians;i++){const t=i/meridians*TAU;this.segment(point(center,a,Math.cos(t)*radius,Math.sin(t)*radius,-height/2),point(center,a,Math.cos(t)*radius,Math.sin(t)*radius,height/2));}return this;}
 lathe(profile,center=[0,0,0],axis=[0,1,0],meridians=24){const a=axes(axis);profile.forEach(([z,r])=>this.ring(add(center,scale(a.z,z)),r,axis));for(let i=0;i<meridians;i++){const t=i/meridians*TAU;this.chain(profile.map(([z,r])=>point(center,a,Math.cos(t)*r,Math.sin(t)*r,z)));}return this;}
 box(center,size){const [x,y,z]=center,[w,h,d]=size,points=[];for(const k of [-1,1])for(const j of [-1,1])for(const i of [-1,1])points.push([x+i*w/2,y+j*h/2,z+k*d/2]);for(let i=0;i<8;i++)for(const axis of [1,2,4])if((i&axis)===0)this.segment(points[i],points[i|axis]);return this;}
 beam(a,b,width=.1,depth=width,braces=3){const f=axes(subtract(b,a)),corners=[[-1,-1],[1,-1],[1,1],[-1,1]],at=(center,i)=>point(center,f,corners[i][0]*width/2,corners[i][1]*depth/2,0);for(let i=0;i<4;i++)this.segment(at(a,i),at(b,i));for(let k=0;k<=braces+1;k++){const c=add(a,scale(subtract(b,a),k/(braces+1)));for(let i=0;i<4;i++)this.segment(at(c,i),at(c,(i+1)%4));if(k<=braces){const d=add(a,scale(subtract(b,a),(k+1)/(braces+1)));this.segment(at(c,k%2),at(d,(k%2+2)%4));}}return this;}
 tube(points,radius=.018,meridians=5){for(let i=1;i<points.length;i++){const f=axes(subtract(points[i],points[i-1]));for(let m=0;m<meridians;m++){const t=m/meridians*TAU;this.segment(point(points[i-1],f,Math.cos(t)*radius,Math.sin(t)*radius,0),point(points[i],f,Math.cos(t)*radius,Math.sin(t)*radius,0));}}return this;}
 gear(center,radius,teeth,depth,thickness,inside=false,spokes=6){
  for(const y of [-thickness/2,thickness/2]){const outline=[];for(let i=0;i<teeth*4;i++){const t=i/(teeth*4)*TAU,r=radius+(inside?-1:1)*depth*([0,1,1,0][i%4]);outline.push(add(center,[Math.cos(t)*r,y,Math.sin(t)*r]));}this.chain(outline,true);this.ring(add(center,[0,y,0]),inside?radius+depth*2.2:radius*.27);for(let i=0;i<spokes;i++){const t=i/spokes*TAU;this.segment(add(center,[Math.cos(t)*radius*.27,y,Math.sin(t)*radius*.27]),add(center,[Math.cos(t)*radius*.94,y,Math.sin(t)*radius*.94]));}}
  for(let i=0;i<teeth;i++){const t=(i+.25)/teeth*TAU,r=radius+(inside?-depth:depth);this.segment(add(center,[Math.cos(t)*r,-thickness/2,Math.sin(t)*r]),add(center,[Math.cos(t)*r,thickness/2,Math.sin(t)*r]));}return this;
 }
}
const part=(name,offset,weight,spin)=>new WirePart(name,offset,weight,spin);
function robot(){
 const head=part('HEAD',[0,.42,.05],.12).lathe([[.78,.07],[.84,.14],[.93,.17],[1.02,.16],[1.09,.11],[1.13,.04]],undefined,undefined,14).ring([0,.95,0],.18).cylinder([0,.72,0],.06,.1,undefined,3,8);
 const torso=part('TORSO',[0,.02,0],.20).beam([0,.17,0],[0,.68,0],.28,.5,3).cylinder([0,.03,0],.15,.24,undefined,4,12).beam([0,-.2,0],[0,-.07,0],.24,.4,1);
 const core=part('CORE',[0,.02,.62],.08);for(let i=1;i<=3;i++)core.ring([0,.46,.15],.085*i/3,[0,0,1]);core.ring([0,.46,.15],.11,[0,0,1]);
 const arms=[1,-1].map(sign=>part(sign===1?'R-ARM':'L-ARM',[sign*.52,.06,0],.16).cylinder([sign*.34,.62,0],.09,.13,[1,0,0],3,10).beam([sign*.36,.56,0],[sign*.43,.2,0],.1,.1,3).cylinder([sign*.43,.18,0],.065,.11,[1,0,0],3,8).beam([sign*.43,.16,0],[sign*.47,-.18,.05],.09,.08,3).beam([sign*.47,-.2,.05],[sign*.48,-.33,.07],.08,.05,1));
 const legs=part('LEGS',[0,-.42,0],.20);for(const sign of [-1,1])legs.cylinder([sign*.13,-.24,0],.075,.12,[1,0,0],3,10).beam([sign*.13,-.27,0],[sign*.15,-.68,0],.13,.12,3).cylinder([sign*.15,-.7,0],.07,.13,[1,0,0],3,8).beam([sign*.15,-.73,0],[sign*.15,-1.08,0],.11,.1,3).beam([sign*.15,-1.12,-.05],[sign*.15,-1.12,.18],.06,.11,1);
 const battery=part('BATTERY',[0,.08,-.62],.08).beam([0,.24,-.2],[0,.62,-.2],.1,.32,2).cylinder([0,.43,-.27],.04,.34,undefined,3,6);
 return {parts:[head,torso,core,...arms,legs,battery],fit:1.15,rotation:rotateX(-.08)};
}
function engine(){
 const nozzle=part('NOZZLE',[0,-.55,0],.24),profile=[];for(let i=0;i<=10;i++){const t=i/10;profile.push([-1.18+t*.76,.19+.34*Math.pow(1-t,.8)]);}nozzle.lathe(profile,undefined,undefined,28);
 const chamber=part('CHAMBER',[0,-.08,0],.16).cylinder([0,-.16,0],.19,.53,undefined,6,20).ring([0,-.4,0],.23).ring([0,.12,0],.25);
 const injector=part('INJECTOR',[0,.32,.03],.12).cylinder([0,.16,0],.28,.11,undefined,3,24);for(let i=1;i<=4;i++)injector.ring([0,.22,0],.23*i/4);
 const pumps=[1,-1].map(sign=>part(sign===1?'LOX PUMP':'CH4 PUMP',[sign*.5,.16,0],.12).cylinder([sign*.36,.36,0],.09,.5,undefined,6,16).cylinder([sign*.36,.7,0],.055,.18,undefined,4,12).ring([sign*.36,.14,0],.14));
 const preburner=part('PREBURNER',[0,.58,-.22],.08).cylinder([0,.68,0],.075,.4,undefined,5,12).ring([0,.9,0],.15);
 const pipes=part('PLUMBING',[.35,.05,.36],.10);for(const sign of [-1,1])pipes.tube([[sign*.36,.7,0],[sign*.23,.74,.15],[sign*.12,.35,.16],[sign*.08,.1,.12]],.024,6).tube([[sign*.36,.28,0],[sign*.56,.06,.08],[sign*.47,-.51,.08],[sign*.25,-.64,.03]],.02,5);
 const mount=part('GIMBAL',[0,.72,0],.06).beam([0,.9,0],[-.39,.65,0],.04,.04,2).beam([0,.9,0],[.39,.65,0],.04,.04,2).beam([0,.9,0],[0,.18,0],.035,.035,2);
 return {parts:[nozzle,chamber,injector,...pumps,preburner,pipes,mount],fit:1,rotation:rotateX(-.2)};
}
function planetary(){
 const sun=part('SUN GEAR',[0,.55,0],.15,1.3).gear([0,0,0],.25,14,.05,.16,false,4).cylinder([0,0,0],.055,.5,undefined,3,6);
 const planets=part('PLANETS',[0,.3,0],.25,-.42),centers=[];for(let i=0;i<3;i++){const a=i/3*TAU+Math.PI/2,p=[Math.cos(a)*.53,0,Math.sin(a)*.53];centers.push(p);planets.gear(p,.2,11,.045,.14,false,4);}
 const ring=part('RING GEAR',[0,.1,0],.21).gear([0,0,0],.8,40,.05,.18,true,0).ring([0,.09,0],.93);
 const carrier=part('CARRIER',[0,-.34,0],.12,-.42).ring([0,-.15,0],.62);centers.forEach(p=>carrier.segment([0,-.15,0],[p[0],-.15,p[2]]).cylinder([p[0],-.05,p[2]],.035,.22,undefined,2,6));
 const shaft=part('OUTPUT',[0,-.8,0],.11,-.42).cylinder([0,-.55,0],.1,.7,undefined,6,10).ring([0,-.22,0],.24);
 const housing=part('HOUSING',[0,-.02,0],.16).cylinder([0,-.02,0],1,.42,undefined,3,32).ring([0,-.23,0],1.12);for(let i=0;i<8;i++){const a=i/8*TAU+.2;housing.ring([Math.cos(a)*1.06,-.23,Math.sin(a)*1.06],.035);}
 return {parts:[sun,planets,ring,carrier,shaft,housing],fit:1.12,rotation:rotateX(.6)};
}
function arm(){
 const shoulder=[0,-.6,0],elbow=[.45,.14,0],wrist=[-.12,.55,0],direction=normalize(subtract(wrist,elbow)),tip=add(wrist,scale(direction,.14));
 const base=part('BASE',[0,-.42,0],.15).cylinder([0,-1,0],.42,.16,undefined,4,24).ring([0,-1.08,0],.52).ring([0,-.92,0],.3);
 const sh=part('SHOULDER',[-.34,-.14,0],.16).cylinder([0,-.8,0],.27,.2,undefined,4,16).cylinder(shoulder,.17,.36,[0,0,1],4,14);
 const upper=part('UPPER ARM',[.36,-.06,.26],.18).beam(shoulder,elbow,.15,.12,6);
 const joint=part('ELBOW',[.48,.1,0],.1).cylinder(elbow,.12,.3,[0,0,1],4,12);
 const fore=part('FOREARM',[.04,.26,.32],.16).beam(elbow,wrist,.11,.09,5);
 const wr=part('WRIST',[-.32,.3,0],.1).cylinder(wrist,.08,.16,direction,3,10).ring(add(wrist,scale(direction,.1)),.1,direction);
 const grip=part('GRIPPER',[-.36,.3,0],.15);for(const s of [-1,1])grip.beam(add(tip,[0,0,s*.07]),add(tip,add(scale(direction,.24),[0,0,s*.1])),.045,.035,2);grip.beam(add(tip,[0,0,-.1]),add(tip,[0,0,.1]),.06,.05,1);
 return {parts:[base,sh,upper,joint,fore,wr,grip],fit:.92,rotation:rotateX(-.1)};
}
function factory(){
 const load=part('LOADING',[-.12,.42,0],.12).lathe([[.14,.05],[.34,.2],[.46,.21]],[-1.2,0,0],undefined,12);for(const x of [-1.36,-1.04])for(const z of [-.16,.16])load.segment([x,-.34,z],[x,.4,z]);
 const machine=part('MACHINING',[0,.4,-.12],.14).box([-.68,.18,0],[.36,.44,.52]).cylinder([-.68,.24,0],.045,.22,undefined,3,8);
 const inspect=part('INSPECTION',[0,.48,.12],.12).beam([-.2,-.04,-.24],[-.2,.36,-.24],.02,.02,1).beam([-.2,-.04,.24],[-.2,.36,.24],.02,.02,1).beam([-.2,.36,-.24],[-.2,.36,.24],.03,.03,1).ring([-.23,.2,0],.13,[1,0,0]);
 const assembler=part('ASSEMBLY',[0,.38,-.28],.12).cylinder([.3,-.04,-.42],.08,.08,undefined,3,10).beam([.3,0,-.42],[.34,.3,-.3],.06,.06,2).beam([.34,.3,-.3],[.32,.12,-.04],.05,.05,2);
 const qc=part('QC GATE',[0,.46,.12],.1);for(let i=0;i<9;i++)qc.segment([.72,.02+i*.038,-.21],[.72,.02+i*.038,.21]);for(const z of [-.21,.21])qc.segment([.72,-.04,z],[.72,.36,z]);
 const pack=part('PACKING',[.12,.42,0],.12).box([1.27,-.12,0],[.34,.04,.34]);for(const x of [1.19,1.35])for(const z of [-.08,.08])pack.box([x,-.03,z],[.14,.14,.14]);pack.box([1.27,.11,0],[.14,.14,.14]);
 const conveyor=part('CONVEYOR',[0,-.32,0],.28);for(const y of [0,-.04])for(const z of [-.13,.13])conveyor.segment([-1.4,y,z],[1.05,y,z]);for(let i=0;i<=24;i++)conveyor.segment([-1.4+i*.1,-.02,-.13],[-1.4+i*.1,-.02,.13]);for(const x of [-1.3,-.7,0,.7,1])for(const z of [-.13,.13])conveyor.segment([x,-.04,z],[x,-.35,z]);for(let i=0;i<8;i++)conveyor.box([-1.25+i*.3,.045,0],[.1,.08,.1]);
 return {parts:[load,machine,inspect,assembler,qc,pack,conveyor],fit:1.25,rotation:rotateX(.5)};
}
function site(){
 const datum=part('DATUM',[0,-.5,0],.1).ring([0,0,0],1.5).ring([0,0,0],1.43);for(let i=0;i<72;i++){const a=i/72*TAU,r=1.5+(i%6===0?.1:.045);datum.segment([Math.cos(a)*1.5,0,Math.sin(a)*1.5],[Math.cos(a)*r,0,Math.sin(a)*r]);}
 const roads=part('ARTERIAL',[0,-.12,0],.14),grid=part('GRID',[0,-.26,0],.13);for(const x of [-1,-.5,0,.5,1]){const span=Math.sqrt(1.4*1.4-x*x);roads.segment([x,.005,-span],[x,.005,span]);grid.segment([-span,-.035,x],[span,-.035,x]);}
 const east=part('BLOCK E',[.28,.14,0],.21),west=part('BLOCK W',[-.28,.14,0],.19),random=visualRandom(731);for(let i=-3;i<=2;i++)for(let j=-3;j<=2;j++){const x=i*.43+.2,z=j*.43+.2;if(Math.hypot(x,z)>1.25)continue;const height=.05+Math.pow(random(),2.2)*.55;(x>0?east:west).box([x,height/2,z],[.23+random()*.08,height,.24+random()*.06]);}
 const route=part('ROUTE',[0,.5,0],.11).tube([[-.95,.02,.96],[-.95,.02,.32],[0,.02,.32],[0,.02,-.62],[.66,.02,-.62],[.66,.02,-.98]],.016,3);
 const pins=part('POI',[0,.72,0],.12);for(const [x,z,h]of [[-.95,.96,.42],[.66,-.98,.42],[.32,.66,.24],[-.62,-.3,.24],[.98,0,.24],[-.3,-.95,.24]])pins.segment([x,0,z],[x,h,z]).ring([x,h,z],.045).ring([x,0,z],.085);
 return {parts:[datum,roads,grid,east,west,route,pins],fit:1.25,rotation:rotateX(.42)};
}
const builders={humanoid:robot,engine,line:factory,city:site,gear:planetary,arm};

/** Weighted wire arclength sampling, then partition into real workflow groups. */
export function projectionGeometry(kind='humanoid',count=23800,desiredParts){
 if(!builders[kind])throw new Error('Unknown FORGE projection');if(!Number.isInteger(count)||count<100||count>60000)throw new Error('Projection point bound');
 const shape=builders[kind](),natural=shape.parts.length,n=Math.max(1,Math.min(10,desiredParts||natural)),random=visualRandom(31013+FORMS.findIndex(row=>row[0]===kind)*379),points=[],assignment=[],physical=[];
 const allocations=new Array(natural).fill(1);if(n>=natural)for(let extra=0;extra<n-natural;extra++){let best=0;for(let i=1;i<natural;i++)if(shape.parts[i].weight/allocations[i]>shape.parts[best].weight/allocations[best])best=i;allocations[best]++;}
 const weight=shape.parts.reduce((sum,p)=>sum+p.weight,0);let collected=0,groupBase=0;
 shape.parts.forEach((component,index)=>{
  const amount=index===natural-1?count-collected:Math.round(count*component.weight/weight),segments=component.segments,cumulative=[];let total=0;
  segments.forEach(([a,b])=>{total+=length(subtract(b,a));cumulative.push(total);});const sampled=[];
  for(let i=0;i<amount;i++){let low=0,high=cumulative.length-1,value=random()*total;while(low<high){const middle=(low+high)>>1;if(cumulative[middle]<value)low=middle+1;else high=middle;}const [a,b]=segments[low],prior=low?cumulative[low-1]:0,t=(value-prior)/(cumulative[low]-prior||1);sampled.push(a.map((v,k)=>v+(b[k]-v)*t+(random()-.5)*.006));}
  const bounds=[0,1,2].map(axis=>{let lo=Infinity,hi=-Infinity;sampled.forEach(p=>{lo=Math.min(lo,p[axis]);hi=Math.max(hi,p[axis]);});return hi-lo;}),axis=bounds.indexOf(Math.max(...bounds));sampled.sort((a,b)=>a[axis]-b[axis]);
  sampled.forEach((p,i)=>{points.push(p);physical.push(index);assignment.push(n<natural?Math.min(n-1,Math.floor(index*n/natural)):groupBase+Math.min(allocations[index]-1,Math.floor(i/Math.max(1,sampled.length)*allocations[index])));});
  if(n>=natural)groupBase+=allocations[index];collected+=amount;
 });
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];points.forEach(p=>p.forEach((v,a)=>{low[a]=Math.min(low[a],v);high[a]=Math.max(high[a],v);}));const center=low.map((v,i)=>(v+high[i])/2),factor=shape.fit/(Math.max(...high.map((v,i)=>v-low[i]))/2);
 const order=Array.from({length:count},(_,i)=>i);for(let i=count-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}
 const target=new Float32Array(count*3),partIds=new Float32Array(count),componentIds=new Float32Array(count),anchors=Array.from({length:n},()=>[0,0,0]),counts=new Array(n).fill(0),spins=new Array(n).fill(0),offsets=Array.from({length:n},()=>[0,0,0]),names=new Array(n).fill(''),physicalCenters=Array.from({length:natural},()=>[0,0,0]),physicalCounts=new Array(natural).fill(0),groupComponents=Array.from({length:n},()=>Array.from({length:natural},()=>({count:0,center:[0,0,0]})));
 for(let i=0;i<count;i++){const index=order[i],p=points[index],id=assignment[index],component=physical[index];partIds[i]=id;componentIds[i]=component;counts[id]++;physicalCounts[component]++;groupComponents[id][component].count++;for(let a=0;a<3;a++){const value=(p[a]-center[a])*factor;target[i*3+a]=value;anchors[id][a]+=value;physicalCenters[component][a]+=value;groupComponents[id][component].center[a]+=value;}}
 physicalCenters.forEach((center,i)=>center.forEach((_,axis)=>center[axis]/=physicalCounts[i]||1));groupComponents.forEach(components=>components.forEach(part=>part.center.forEach((_,axis)=>part.center[axis]/=part.count||1)));
 let base=0;shape.parts.forEach((p,index)=>{const groups=n<natural?[Math.min(n-1,Math.floor(index*n/natural))]:Array.from({length:allocations[index]},(_,i)=>base+i);groups.forEach(id=>{spins[id]=p.spin;names[id]=names[id]?names[id]+' + '+p.name:p.name;offsets[id]=scale(p.offset,factor*.62);});if(n>=natural)base+=allocations[index];});
 anchors.forEach((anchor,index)=>{for(let a=0;a<3;a++)anchor[a]/=counts[index]||1;if(length(offsets[index])<.06)offsets[index]=scale(normalize(add(anchor,[0,.1,0])),.24);});
 return {kind,count,partCount:n,target,partIds,componentIds,physicalCenters,physicalSpins:shape.parts.map(part=>part.spin),groupComponents,anchors,offsets,spins,names,rotation:shape.rotation,bounds:{low:low.map((v,i)=>(v-center[i])*factor),high:high.map((v,i)=>(v-center[i])*factor)}};
}

export function ribbonGeometry(compact=false){
 const profile=typeof compact==='object'?compact:null,bands=14,lanes=profile?.lanes||10,per=profile?.per||(compact?96:170),count=bands*lanes*per,random=visualRandom(20261024),orbit=new Float32Array(count*4),basis=new Float32Array(count*4),wave=new Float32Array(count*4),drift=new Float32Array(count*4),indices=new Uint16Array(count*2);let index=0;
 for(let band=0;band<bands;band++){
  const rot=[random()*TAU,random()*TAU,random()*TAU,.06+random()*.11],shape=[1+Math.floor(random()*3),random()*TAU,.05+random()*.15,(1+Math.floor(random()*2))*(random()<.5?-1:1)],motion=[(random()-.5)*.22,(random()-.5)*.3,random()<.42?.72+random()*.28:random()*.3,.72+random()*.34],speed=(.16+random()*.22)*(random()<.5?-1:1);
  for(let lane=0;lane<lanes;lane++)for(let sample=0;sample<per;sample++,index++){
   orbit.set([sample/per*TAU,lane/(lanes-1)*2-1,speed,random()],index*4);basis.set(rot,index*4);wave.set(shape,index*4);drift.set(motion,index*4);indices[index*2]=index;indices[index*2+1]=index-sample+(sample+1)%per;
  }
 }
 return {bands,lanes,per,count,orbit,basis,wave,drift,indices};
}
export function orbitGeometry(compact=false){
 const random=visualRandom(4242),rings=58,per=128,positions=new Float32Array(rings*per*4),extra=new Float32Array(rings*per*2),indices=new Uint16Array(rings*per*2),definitions=[];
 for(let i=0;i<rings;i++){
  const ring=[(random()-.5)*1.55,(random()-.5)*.95,1.12+Math.pow(random(),.85),.03+random()*.055];definitions.push(ring);
  for(let j=0;j<per;j++){const at=i*per+j;positions.set([ring[0],ring[1],ring[2],j/per*TAU],at*4);extra.set([0,ring[3]],at*2);indices[at*2]=at;indices[at*2+1]=i*per+(j+1)%per;}
 }
 const dustCount=compact?520:1100,dust=new Float32Array(dustCount*4),dustExtra=new Float32Array(dustCount*2),labelOrbits=[];for(let i=0;i<dustCount;i++){const ring=definitions[Math.floor(random()*rings)],angle=random()*TAU,speed=(.22+random()*.3)/ring[2],brightness=Math.pow(random(),3);dust.set([ring[0],ring[1],ring[2],angle],i*4);dustExtra.set([speed,brightness],i*2);if(labelOrbits.length<8&&ring[2]>1.7&&brightness>.2)labelOrbits.push({tiltX:ring[0],tiltZ:ring[1],radius:ring[2],angle,speed});}
 while(labelOrbits.length<8){const ring=definitions[labelOrbits.length*5%rings];labelOrbits.push({tiltX:ring[0],tiltZ:ring[1],radius:Math.max(1.75,ring[2]),angle:random()*TAU,speed:.15});}
 const starCount=compact?380:900,stars=new Float32Array(starCount*4);for(let i=0;i<starCount;i++)stars.set([random(),random(),.8+Math.pow(random(),4)*2.2,random()],i*4);
 return {rings,per,positions,extra,indices,dust,dustExtra,dustCount,stars,starCount,labelOrbits};
}
