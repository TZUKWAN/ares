import {productGeometry,productRadius} from './product-geometry.js';
import {ribbonGeometry,orbitGeometry,projectionGeometry,transform,rotateY,add,scale} from './forge-geometry.js?v=2.3.0-forge-faithful';
const vertexHelpers=`
vec3 rx(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x,p.y*c-p.z*s,p.y*s+p.z*c);}
vec3 ry(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x*c+p.z*s,p.y,-p.x*s+p.z*c);}
vec3 rz(vec3 p,float a){float c=cos(a),s=sin(a);return vec3(p.x*c-p.y*s,p.x*s+p.y*c,p.z);}
uniform vec2 screenSize,centerPx;uniform float sceneScale,pixelRatio;
vec4 projectPoint(vec3 p,out float perspective,out vec2 screen){perspective=5.0/max(.25,5.0-p.z);screen=centerPx+vec2(p.x,-p.y)*sceneScale*perspective;return vec4(screen.x/screenSize.x*2.0-1.0,1.0-screen.y/screenSize.y*2.0,0.,1.);}
float blendAt(float value,float delay){float x=clamp((value-delay)/.65,0.,1.);return x*x*(3.-2.*x);}
`;
const coreVertex=`precision highp float;
attribute vec4 orbit,basis,wave,drift;attribute vec3 target;attribute float group,component;
uniform mat3 viewMatrix,formMatrix;uniform float time,linePass,holeRadius;
uniform vec4 phase,visual;uniform vec3 groupOffset[10],groupState[10];uniform vec4 componentPose[8];
varying vec3 tint;varying float opacity;
${vertexHelpers}
void main(){
 float angle=orbit.x+time*orbit.z,rad=drift.w*(1.+wave.z*sin(wave.x*angle+wave.y));
 vec3 ribbon=vec3(cos(angle)*rad,sin(angle)*rad,wave.z*.9*sin((wave.x+1.)*angle+wave.y*1.7));
 float twist=wave.w*angle+wave.y;vec3 normal=vec3(cos(angle),sin(angle),0.)*cos(twist)+vec3(0.,0.,1.)*sin(twist);
 ribbon+=normal*orbit.y*basis.w;ribbon=rz(ry(rx(ribbon,basis.x+time*drift.x),basis.y+time*drift.y),basis.z)*visual.x;
 float radius=1.+(drift.w-.89)*.55+orbit.y*.05;vec3 ring=rx(vec3(cos(angle)*radius,orbit.y*.022+sin(angle*2.+time*1.7)*.014,sin(angle)*radius),.16);
 int index=int(group+.5),physical=int(component+.5);vec3 pivot=componentPose[physical].xyz;vec3 formed=pivot+ry(target-pivot,componentPose[physical].w*time)+groupOffset[index]*phase.z;formed=formMatrix*formed;
 float collapse=blendAt(phase.x,orbit.w*.35),shape=blendAt(phase.y,orbit.w*.35);
 vec3 point=mix(mix(ribbon,ring,collapse),formed,shape);
 float turn=sin(shape*3.14159265)*(.9+orbit.w*1.4)+sin(collapse*3.14159265)*.7;point=ry(point,turn)*(1.+sin(shape*3.14159265)*.22*orbit.w);
 vec3 view=viewMatrix*point;float perspective;vec2 screen;gl_Position=projectPoint(view,perspective,screen);
 float visible=(view.z<0.&&length(screen-centerPx)<holeRadius)?0.:1.;visible=mix(visible,1.,shape);
 float lane=1.-abs(orbit.y);vec3 ribbonColor=mix(mix(vec3(.52,.74,1.),vec3(1.,.7,.52),drift.z),vec3(.95,.97,1.),lane*.38);
 vec3 ringColor=mix(vec3(1.,.84,.64),vec3(1.,.97,.92),lane*.6);
 float done=groupState[index].y,heat=groupState[index].z*(.86+.14*sin(time*18.+orbit.w*40.));
 vec3 formColor=mix(vec3(.44,.68,.98),vec3(.8,.95,1.),done);formColor=mix(formColor,vec3(.74,.92,1.),phase.w*.75);formColor=mix(formColor,vec3(1.,.6,.26),heat);
 tint=mix(mix(ribbonColor,ringColor,collapse),formColor,shape);
 float focus=visual.z<0.?1.:(abs(group-visual.z)<.5?1.35:.3);
 float formAlpha=mix(mix(.46,.82,max(done,heat)),.8,phase.w)*focus;float depth=.62+.38*clamp(view.z*.6+.5,0.,1.);
 opacity=mix(mix(.42,.55,collapse),formAlpha,shape)*visible*depth*visual.w;
 if(linePass>.5){float inverse=1.-shape;opacity*=.6*inverse*inverse*inverse;}
 gl_PointSize=visual.y*pixelRatio*perspective*(.75+orbit.w*.5)*(1.+heat*.7*shape)*mix(1.,1.25,shape);
}`;
const pointFragment=`precision highp float;varying vec3 tint;varying float opacity;uniform float linePass;void main(){float alpha=opacity;if(linePass<.5){vec2 q=gl_PointCoord-.5;float d=dot(q,q)*4.;alpha*=exp(-d*3.2)*step(d,1.);}gl_FragColor=vec4(tint*alpha,alpha);}`;
const orbitVertex=`precision highp float;attribute vec4 orbit;attribute vec2 detail;uniform mat3 viewMatrix;uniform float time,dustTime,dustPass,holeRadius,ambientAlpha;varying vec3 tint;varying float opacity;
${vertexHelpers}
void main(){float angle=orbit.w+dustPass*dustTime*detail.x;vec3 point=vec3(cos(angle)*orbit.z,0.,sin(angle)*orbit.z);point=ry(rz(rx(point,orbit.x),orbit.y),time*.025*(.6+orbit.x));vec3 view=viewMatrix*point;float perspective;vec2 screen;gl_Position=projectPoint(view,perspective,screen);float visible=(view.z<0.&&length(screen-centerPx)<holeRadius)?0.:1.;opacity=ambientAlpha*(dustPass>.5?(.3+.7*detail.y):detail.y)*visible*(.5+.5*smoothstep(-2.2,2.2,view.z));tint=mix(vec3(.72,.8,.9),vec3(.95,.97,1.),detail.y);gl_PointSize=(1.1+detail.y*2.4)*pixelRatio*perspective;}`;
const starVertex=`precision highp float;attribute vec4 star;uniform float time,pixelRatio;varying vec3 tint;varying float opacity;void main(){gl_Position=vec4(star.x*2.-1.,1.-star.y*2.,0.,1.);opacity=(.05+.22*fract(star.w*7.13))*(.6+.4*sin(time*(.4+fract(star.w*3.7))+star.w*50.));tint=vec3(.78,.86,1.);gl_PointSize=star.z*pixelRatio;}`;
const holeVertex=`precision highp float;attribute vec2 corner;uniform vec2 screenSize,centerPx;uniform float radius;varying vec2 position;void main(){position=centerPx+corner*radius*6.;gl_Position=vec4(position.x/screenSize.x*2.-1.,1.-position.y/screenSize.y*2.,0.,1.);}`;
const holeFragment=`precision highp float;uniform vec2 centerPx;uniform float radius,time,energy,pulse,warm,alpha,mature;varying vec2 position;
float bell(float x,float center,float spread){float q=(x-center)/spread;return exp(-q*q);}
void main(){vec2 q=position-centerPx;q.y=-q.y;float r=length(q)/radius,a=atan(q.y,q.x);vec3 hue=mix(vec3(.8,.88,1.),vec3(1.,.8,.62),warm);float directional=.5+.5*cos(a-2.3);float halo=exp(-max(r-1.,0.)*2.5)*.17*(.75+energy*.7);float pattern=(.5+.5*sin(a*9.+r*13.-time*1.2))*.6+(.5+.5*sin(a*17.-r*21.+time*.8+1.7))*.4;float corona=bell(r,1.28,.34)*pattern*.11*(.6+energy);float rim=bell(r,1.,.02)*(.45+.95*directional)*(.85+energy*.6)+bell(r,1.05,.07)*.22*(.4+directional)+bell(r,1.62,.045)*.05;float shock=pulse>=0.?bell(r,1.+pulse*3.6,.05+pulse*.12)*(1.-pulse)*.55:0.;float disk=bell(length(vec2(q.x,q.y*3.4))/radius,1.62,.16)*mature*.45;vec3 light=hue*(halo*(.6+.6*directional)+corona+rim+shock+disk);float disc=1.-smoothstep(.985,1.,r);vec3 dark=vec3(.004,.005,.008)+hue*.035*smoothstep(.55,1.,r)*directional;gl_FragColor=vec4(mix(light,dark,disc),disc)*alpha;}`;

const productVertex=`precision highp float;
attribute vec2 corner;uniform vec2 screenSize,centerPx;uniform float radius;varying vec2 surfacePoint;
void main(){surfacePoint=corner*1.36;vec2 pixel=centerPx+surfacePoint*radius;gl_Position=vec4(pixel.x/screenSize.x*2.-1.,1.-pixel.y/screenSize.y*2.,0.,1.);}`;
const productFragment=`precision highp float;
varying vec2 surfacePoint;uniform float time;uniform mat3 viewMatrix;
float hash2(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash2(i),hash2(i+vec2(1.,0.)),f.x),mix(hash2(i+vec2(0.,1.)),hash2(i+vec2(1.,1.)),f.x),f.y);}
float clouds(vec2 p){float value=0.,weight=.55;for(int i=0;i<3;i++){value+=noise2(p)*weight;p=mat2(.8,-.6,.6,.8)*p*2.03+vec2(8.7,3.1);weight*=.5;}return value;}
void main(){
 vec2 p=surfacePoint;float r=length(p);if(r>1.33)discard;
 float z=sqrt(max(0.,1.-dot(p,p)));vec3 n=vec3(p.x,-p.y,z);
 float turn=time*.028,c=cos(turn),s=sin(turn);vec3 facing=vec3(dot(viewMatrix[0],n),dot(viewMatrix[1],n),dot(viewMatrix[2],n));vec3 surface=vec3(facing.x*c+facing.z*s,facing.y,-facing.x*s+facing.z*c);
 vec2 uv=surface.xy*4.2+surface.z*vec2(1.3,-.8);
 float region=noise2(surface.xz*2.2+surface.y*.6+vec2(3.7,1.2));
 float vapor=clouds(uv+vec2(region*.7,region*.25));
 vec3 sea=mix(vec3(.035,.13,.24),vec3(.12,.39,.59),region);
 float cloud=smoothstep(.43,.77,vapor);vec3 material=mix(sea,vec3(.72,.84,.9),cloud*.66);
 vec3 light=normalize(vec3(-.6,.7,1.1));float sunlight=max(0.,dot(n,light));
 vec3 color=material*(.055+sunlight*1.08);
 color+=vec3(.025,.07,.12)*(.5+.5*n.y);
 float spec=pow(max(0.,dot(normalize(light+vec3(0.,0.,1.)),n)),42.);color+=vec3(.65,.85,1.)*spec*.16;
 float fresnel=pow(1.-z,3.5);color+=vec3(.19,.48,.7)*fresnel*(.12+sunlight*.33);
 float disk=1.-smoothstep(.993,1.006,r);
 float edge=(r-1.012)/.067;float halo=exp(-edge*edge)*.2+exp(-max(0.,r-1.)*9.)*.018;
 float air=halo*(1.-disk);gl_FragColor=vec4(color*disk+vec3(.17,.45,.74)*air,disk+air);
}`;

export function projectedPoint(point,view,layout,zoom=1){const p=transform(view,point),k=5/Math.max(.25,5-p[2]);return [layout.cx+p[0]*layout.scale*zoom*k,layout.cy-p[1]*layout.scale*zoom*k,p[2]];}
export function partPosition(form,index,state,time=0){const components=form.groupComponents[index],center=[0,0,0];let total=0;components.forEach((part,i)=>{if(!part.count)return;const pivot=form.physicalCenters[i],point=add(pivot,transform(rotateY(form.physicalSpins[i]*time),subtract3(part.center,pivot)));for(let axis=0;axis<3;axis++)center[axis]+=point[axis]*part.count;total+=part.count;});for(let axis=0;axis<3;axis++)center[axis]/=total||1;return transform(form.rotation,add(center,scale(form.offsets[index],state.explode)));}

export function createForgeRenderer(canvas,{compact=false}={}){
 const gl=canvas.getContext('webgl',{alpha:false,antialias:true,premultipliedAlpha:false,preserveDrawingBuffer:true,powerPreference:'low-power'});if(!gl)throw new Error('WebGL unavailable');
 let ribbons=ribbonGeometry(compact),densityKey=1,drawnSteps=0,drawnMembers=0,drawnProducts=0;const buffers=[],programs=[],shaders=[],cache=new Map(),space=orbitGeometry(compact),attributeSlots=Math.min(8,gl.getParameter(gl.MAX_VERTEX_ATTRIBS));let layout,form,disposed=false,firstGlError=0;
 const upload=(data,type=gl.ARRAY_BUFFER,usage=gl.STATIC_DRAW)=>{const buffer=gl.createBuffer();buffers.push(buffer);gl.bindBuffer(type,buffer);gl.bufferData(type,data,usage);return buffer;};
 function program(vertex,fragment){const p=gl.createProgram();programs.push(p);for(const [kind,source]of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]){const shader=gl.createShader(kind);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'FORGE shader compile error');gl.attachShader(p,shader);}gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'FORGE program link error');return {p,locations:new Map()};}
 let core,orbits,stars,hole,product,b={};
 function dispose(){if(disposed)return;disposed=true;buffers.forEach(buffer=>gl.deleteBuffer(buffer));programs.forEach(p=>gl.deleteProgram(p));shaders.forEach(shader=>gl.deleteShader(shader));cache.clear();gl.getExtension('WEBGL_lose_context')?.loseContext();}
 try{
  core=program(coreVertex,pointFragment);orbits=program(orbitVertex,pointFragment);stars=program(starVertex,pointFragment);hole=program(holeVertex,holeFragment);product=program(productVertex,productFragment);const surface=productGeometry();b.productPosition=upload(surface.positions);b.productIndices=upload(surface.indices,gl.ELEMENT_ARRAY_BUFFER);b.productCount=0;b.productVertices=surface.positions.length/2;b.productTriangles=surface.indices.length/3;
  for(const key of ['orbit','basis','wave','drift'])b[key]=upload(ribbons[key]);b.lines=upload(ribbons.indices,gl.ELEMENT_ARRAY_BUFFER);b.target=upload(new Float32Array(ribbons.count*3),gl.ARRAY_BUFFER,gl.DYNAMIC_DRAW);b.group=upload(new Float32Array(ribbons.count),gl.ARRAY_BUFFER,gl.DYNAMIC_DRAW);b.component=upload(new Float32Array(ribbons.count),gl.ARRAY_BUFFER,gl.DYNAMIC_DRAW);
  b.orbitPosition=upload(space.positions);b.orbitDetail=upload(space.extra);b.orbitIndex=upload(space.indices,gl.ELEMENT_ARRAY_BUFFER);b.dust=upload(space.dust);b.dustDetail=upload(space.dustExtra);b.stars=upload(space.stars);b.quad=upload(new Float32Array([-1,-1,1,-1,-1,1,1,1]));gl.disable(gl.DEPTH_TEST);gl.enable(gl.BLEND);
 }catch(error){dispose();throw error;}
 const location=(program,name)=>{if(!program.locations.has(name))program.locations.set(name,gl.getUniformLocation(program.p,name));return program.locations.get(name);};
 const f=(p,name,value)=>gl.uniform1f(location(p,name),value),v2=(p,name,a,c)=>gl.uniform2f(location(p,name),a,c);
 function use(p){for(let i=0;i<attributeSlots;i++)gl.disableVertexAttribArray(i);gl.useProgram(p.p);}
 function attribute(p,name,buffer,size){const index=gl.getAttribLocation(p.p,name);if(index<0)return;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,0,0);}
 function projection(p,view,zoom,node){v2(p,'screenSize',canvas.width,canvas.height);v2(p,'centerPx',(node?.x??layout.cx)*layout.dpr,(node?.y??layout.cy)*layout.dpr);f(p,'sceneScale',(node?.scale??layout.scale*zoom)*layout.dpr);f(p,'pixelRatio',layout.dpr);gl.uniformMatrix3fv(location(p,'viewMatrix'),false,view);}
 function setForm(kind,count){const nodeCount=Math.max(1,count);if(densityKey!==nodeCount){densityKey=nodeCount;ribbons=nodeCount===1?ribbonGeometry(compact):ribbonGeometry({lanes:6,per:Math.max(12,Math.min(170,Math.floor((compact?27000:47000)/(nodeCount*84))))});for(const name of ['orbit','basis','wave','drift']){gl.bindBuffer(gl.ARRAY_BUFFER,b[name]);gl.bufferData(gl.ARRAY_BUFFER,ribbons[name],gl.STATIC_DRAW);}gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.lines);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,ribbons.indices,gl.STATIC_DRAW);for(const [name,size]of [['target',3],['group',1],['component',1]]){gl.bindBuffer(gl.ARRAY_BUFFER,b[name]);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(ribbons.count*size),gl.DYNAMIC_DRAW);}cache.clear();}const key=kind+':'+count;if(!cache.has(key))cache.set(key,projectionGeometry(kind,ribbons.count,count));form=cache.get(key);gl.bindBuffer(gl.ARRAY_BUFFER,b.target);gl.bufferSubData(gl.ARRAY_BUFFER,0,form.target);gl.bindBuffer(gl.ARRAY_BUFFER,b.group);gl.bufferSubData(gl.ARRAY_BUFFER,0,form.partIds);gl.bindBuffer(gl.ARRAY_BUFFER,b.component);gl.bufferSubData(gl.ARRAY_BUFFER,0,form.componentIds);return form;}
 function resize(next){layout=next;canvas.width=Math.max(2,Math.round(layout.width*layout.dpr));canvas.height=Math.max(2,Math.round(layout.height*layout.dpr));}
 function draw({time,dustTime=time,view,zoom=1,focus=-1,state,nodes}){
  if(disposed||!layout||!form)return;gl.viewport(0,0,canvas.width,canvas.height);gl.clearColor(5/255,7/255,10/255,1);gl.clear(gl.COLOR_BUFFER_BIT);
  gl.blendFunc(gl.ONE,gl.ONE);use(stars);f(stars,'time',time);f(stars,'pixelRatio',layout.dpr);f(stars,'linePass',0);attribute(stars,'star',b.stars,4);gl.drawArrays(gl.POINTS,0,space.starCount);
  use(orbits);f(orbits,'ambientAlpha',nodes?.some(node=>node.kind==='product')?.08:1);projection(orbits,view,zoom);for(const [name,value]of Object.entries({time,dustTime,holeRadius:0,dustPass:0,linePass:1}))f(orbits,name,value);attribute(orbits,'orbit',b.orbitPosition,4);attribute(orbits,'detail',b.orbitDetail,2);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.orbitIndex);gl.drawElements(gl.LINES,space.indices.length,gl.UNSIGNED_SHORT,0);f(orbits,'dustPass',1);f(orbits,'linePass',0);attribute(orbits,'orbit',b.dust,4);attribute(orbits,'detail',b.dustDetail,2);gl.drawArrays(gl.POINTS,0,space.dustCount);
  const fields=nodes?.length?nodes:[{kind:'step',x:layout.cx,y:layout.cy,scale:layout.scale*zoom,opacity:1,depth:0}];drawnSteps=fields.filter(node=>node.kind==='step').length;drawnMembers=fields.filter(node=>node.kind==='member').length;drawnProducts=fields.filter(node=>node.kind==='product').length;
  for(const node of [...fields].sort((a,c)=>(a.depth||0)-(c.depth||0))){if(node.kind==='product'){use(product);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);v2(product,'screenSize',canvas.width,canvas.height);v2(product,'centerPx',node.x*layout.dpr,node.y*layout.dpr);f(product,'radius',productRadius(node.scale)*layout.dpr);f(product,'time',time);gl.uniformMatrix3fv(location(product,'viewMatrix'),false,view);attribute(product,'corner',b.productPosition,2);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.productIndices);gl.drawElements(gl.TRIANGLES,b.productTriangles*3,gl.UNSIGNED_SHORT,0);continue;}const radius=node.scale*.42*layout.dpr,localTime=time+(node.kind==='step'?(node.index||0)*.17:0),alpha=(node.opacity??1)*(drawnProducts&&node.kind==='step'?.45:1);
   use(hole);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);v2(hole,'screenSize',canvas.width,canvas.height);v2(hole,'centerPx',node.x*layout.dpr,node.y*layout.dpr);for(const [name,value]of Object.entries({radius,time:localTime,energy:state.energy,pulse:-1,warm:0,alpha,mature:node.kind==='member'?1:0}))f(hole,name,value);attribute(hole,'corner',b.quad,2);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
   if(node.kind==='member')continue;
   use(core);gl.blendFunc(gl.ONE,gl.ONE);projection(core,view,zoom,node);gl.uniformMatrix3fv(location(core,'formMatrix'),false,form.rotation);f(core,'time',localTime);f(core,'holeRadius',radius);gl.uniform4f(location(core,'phase'),0,0,0,0);gl.uniform4f(location(core,'visual'),1+Math.sin(localTime*1.3)*.025+(state.energy-.6)*.05,drawnProducts?.9:nodes?.length?1.05:compact?1.7:1.55,-1,alpha);
   const offsets=new Float32Array(30),status=new Float32Array(30),physical=new Float32Array(32);form.physicalCenters.forEach((center,i)=>physical.set([...center,0],i*4));gl.uniform4fv(location(core,'componentPose[0]'),physical);gl.uniform3fv(location(core,'groupOffset[0]'),offsets);gl.uniform3fv(location(core,'groupState[0]'),status);
   for(const key of ['orbit','basis','wave','drift'])attribute(core,key,b[key],4);attribute(core,'target',b.target,3);attribute(core,'group',b.group,1);attribute(core,'component',b.component,1);f(core,'linePass',1);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.lines);gl.drawElements(gl.LINES,ribbons.indices.length,gl.UNSIGNED_SHORT,0);f(core,'linePass',0);gl.drawArrays(gl.POINTS,0,ribbons.count);
  }
 }
 return {kind:'webgl',setForm,resize,draw,dispose,labelOrbits:space.labelOrbits,get form(){return form;},stats:()=>{const error=gl.getError();if(error&&!firstGlError)firstGlError=error;return {points:ribbons.count,pointsPerNode:ribbons.count,processNodes:drawnSteps,memberNodes:drawnMembers,productNodes:drawnProducts,productSurfaceVertices:drawnProducts*b.productVertices,productSurfaceTriangles:drawnProducts*b.productTriangles,totalPoints:ribbons.count*drawnSteps+drawnProducts*b.productCount,bands:ribbons.bands,lanes:ribbons.lanes,orbitRings:space.rings,dust:space.dustCount,stars:space.starCount,glError:firstGlError};}};
}

/** Actual low-density point-cloud fallback, not a picture or successful GPU claim. */
export function createCompatibleForgeRenderer(canvas){
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas unavailable');let layout,form,count=3600,drawnSteps=0,drawnMembers=0,drawnProducts=0;
 return {kind:'canvas-2d',setForm(kind,parts){count=parts>1?Math.max(200,Math.floor(9000/parts)):3600;form={partCount:parts,names:Array(Math.max(1,parts)).fill('NODE')};return form;},get form(){return form;},resize(value){layout=value;canvas.width=Math.round(value.width*value.dpr);canvas.height=Math.round(value.height*value.dpr);},draw({time,view,zoom=1,state,nodes}){
  if(!layout||!form)return;ctx.setTransform(layout.dpr,0,0,layout.dpr,0,0);ctx.fillStyle='#05070a';ctx.fillRect(0,0,layout.width,layout.height);ctx.globalCompositeOperation='lighter';
  const fields=nodes?.length?nodes:[{kind:'step',x:layout.cx,y:layout.cy,scale:layout.scale*zoom,opacity:1}];drawnSteps=fields.filter(node=>node.kind==='step').length;drawnMembers=fields.filter(node=>node.kind==='member').length;drawnProducts=fields.filter(node=>node.kind==='product').length;
  for(const node of fields){if(node.kind==='product'){
 const radius=productRadius(node.scale),x=node.x,y=node.y;ctx.save();ctx.globalAlpha=node.opacity??1;ctx.globalCompositeOperation='source-over';
 const air=ctx.createRadialGradient(x,y,radius*.88,x,y,radius*1.3);air.addColorStop(0,'rgba(59,134,190,0)');air.addColorStop(.38,'rgba(64,145,205,.19)');air.addColorStop(1,'rgba(35,100,170,0)');ctx.fillStyle=air;ctx.beginPath();ctx.arc(x,y,radius*1.3,0,Math.PI*2);ctx.fill();
 ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.clip();
 const body=ctx.createRadialGradient(x-radius*.4,y-radius*.42,radius*.04,x,y,radius*1.22);body.addColorStop(0,'#b5d3e5');body.addColorStop(.24,'#6a9cbc');body.addColorStop(.55,'#28628b');body.addColorStop(.82,'#102e4c');body.addColorStop(1,'#030d1a');ctx.fillStyle=body;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
 ctx.strokeStyle='rgba(182,214,232,.12)';ctx.lineWidth=radius*.1;ctx.lineCap='round';for(let band=0;band<3;band++){const by=y+radius*(band*.37-.55);ctx.beginPath();ctx.moveTo(x-radius,by);ctx.bezierCurveTo(x-radius*.4,by-radius*.27,x+radius*.2,by+radius*.2,x+radius*.85,by-radius*.08);ctx.stroke();}
 const shade=ctx.createLinearGradient(x-radius,y-radius,x+radius,y+radius);shade.addColorStop(0,'rgba(1,8,20,0)');shade.addColorStop(.6,'rgba(1,8,20,0)');shade.addColorStop(1,'rgba(1,8,20,.65)');ctx.fillStyle=shade;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);ctx.restore();continue;
}
const local={...layout,cx:node.x,cy:node.y,scale:node.scale},S=node.scale;ctx.globalAlpha=node.opacity??1;if(node.kind==='step')for(let i=0;i<count;i++){const a=i/count*Math.PI*28+time*.25,r=.76+(i%170)/170*.3,p=projectedPoint([Math.cos(a)*r,Math.sin(a)*r,Math.sin(a*3+i)*.18],view,local,1);if(p[2]<0&&Math.hypot(p[0]-node.x,p[1]-node.y)<S*.42)continue;ctx.fillStyle='rgba(156,208,255,.65)';ctx.fillRect(p[0],p[1],1,1);}ctx.globalCompositeOperation='source-over';ctx.fillStyle='#010205';ctx.beginPath();ctx.arc(node.x,node.y,S*.42,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b6d7f3';ctx.lineWidth=1;ctx.shadowColor='#c2e5ff';ctx.shadowBlur=S*.12;ctx.stroke();if(node.kind==='member'){ctx.beginPath();ctx.ellipse(node.x,node.y,S*.72,S*.16,0,0,Math.PI*2);ctx.stroke();}ctx.shadowBlur=0;ctx.globalCompositeOperation='lighter';}
  ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
 },stats:()=>({points:count,pointsPerNode:count,processNodes:drawnSteps,memberNodes:drawnMembers,productNodes:drawnProducts,productSurfaceVertices:0,productSurfaceTriangles:0,totalPoints:count*drawnSteps,bands:14,lanes:6,orbitRings:0,dust:0,stars:0,glError:null}),dispose(){}};
}
function subtract3(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
