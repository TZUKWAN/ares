/** The only visual state is accretion. Business state is read separately. */
export const PHASES=['ingest'];
export const PHASE_NAMES={ingest:'吸积'};
export const CAMERA_MODES=[{id:'orbit',name:'环绕',pitch:.36,spin:.07},{id:'front',name:'正视',pitch:.1,spin:0},{id:'top',name:'俯瞰',pitch:.95,spin:.03}];
export const clamp=(value,low=0,high=1)=>Math.max(low,Math.min(high,value));
export const smooth=value=>{const x=clamp(value);return x*x*(3-2*x);};
export function phaseDuration(phase){if(phase!=='ingest')throw new Error('已移除该动画阶段');return 12;}
export function cycleDuration(){return 12;}
export function phaseStart(phase){if(phase!=='ingest')throw new Error('已移除该动画阶段');return 0;}
export function animationAt(elapsed,parts=1){const count=Math.max(1,Math.min(10,Math.round(parts)||1)),time=Math.max(0,Number(elapsed)||0),local=time%12,progress=local/12;return {phase:'ingest',local,duration:12,progress,time,total:12,cycle:0,ring:0,form:0,explode:0,energy:.65-.2*Math.cos(progress*Math.PI*2),warm:0,holeScale:1,holeAlpha:1,whole:0,active:-1,pulse:-1,done:Array(count).fill(0),hot:Array(count).fill(0),partProgress:Array(count).fill(0),step:0,stepProgress:0,labelOpacity:0};}
export function actualAnimation(model,clock){const state=animationAt(clock.time,model.parts.length);state.done=model.parts.map(part=>part.accepted?1:0);state.hot=model.parts.map(part=>part.running?1:0);state.partProgress=model.parts.map(part=>part.acceptanceRatio);state.factMode='actual';return state;}
