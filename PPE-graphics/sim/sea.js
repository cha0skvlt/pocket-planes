/**
 * Sea model (plain JS, no three): single source of truth for physics and shader.
 *  - deep-water dispersion ω²=g·k (frequencies used to be arbitrary, ~1.36x faster than physics);
 *  - waves run DOWNWIND (the k·x+ω·t phase used to drive them against the wind);
 *  - Pierson–Moskowitz spectrum: stronger wind grows long waves, short ones saturate; swell never vanishes instantly;
 *  - sea direction chases the wind with a lag;
 *  - modulation (wave groups + crest bending) from a tiled noise field - crests stop repeating.
 * Any formula change goes here and into shaders/ocean.js at the same time (golden test: tests/sim.test.mjs).
 */
const G=9.81,TAU=Math.PI*2;
export const N=7,NMOD=5,U_REF=12,MOD_SIZE=256,WARP=1.5;
const K=[.045,.08,.14,.27,.5,1.2,2.3],A0=[5,3.2,2,1,.5,.12,.06];
const D0=[[.8,.6],[-.5,.85],[.95,-.3],[.2,-.98],[-.9,-.45],[.6,.8],[-.7,.7]];
export const TH0=Math.atan2(.6,.8);
const OFF=D0.map(d=>Math.atan2(d[1],d[0])-TH0);          // direction fan relative to the wind (as in the original)
const OM=K.map(k=>Math.sqrt(G*k)),CG=OM.map((w,i)=>w/(2*K[i]));
function rng(s){return()=>{s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const R=rng(20261102),PH=K.map(()=>R()*TAU),OU=K.map(()=>R()),OV=K.map(()=>R());
const LAM=K.map(k=>TAU/k),SAL=LAM.map(l=>1/(8*6*l)),SAC=LAM.map(l=>1/(8*4*l));   // group length ~6λ, crest length ~4λ

function tileNoise(M,cells,r){const g=new Float32Array(cells*cells).map(()=>r()),o=new Float32Array(M*M);
 for(let y=0;y<M;y++){const fy=y/M*cells,y0=Math.floor(fy),ty=fy-y0,sy=ty*ty*(3-2*ty);
  for(let x=0;x<M;x++){const fx=x/M*cells,x0=Math.floor(fx),tx=fx-x0,sx=tx*tx*(3-2*tx),x1=(x0+1)%cells,y1=(y0+1)%cells;
   const a=g[y0*cells+x0],b=g[y0*cells+x1],c=g[y1*cells+x0],d=g[y1*cells+x1];
   o[y*M+x]=(a+(b-a)*sx)*(1-sy)+(c+(d-c)*sx)*sy}}return o}
function field(M,r){const f=new Float32Array(M*M);let a=1;
 for(let o=0;o<4;o++){const n=tileNoise(M,8<<o,r);for(let i=0;i<f.length;i++)f[i]+=n[i]*a;a*=.5}
 let m=0;for(const v of f)m+=v;m/=f.length;let s=0;for(const v of f)s+=(v-m)*(v-m);s=Math.sqrt(s/f.length)||1;
 return f.map(v=>Math.min(1,Math.max(0,.5+(v-m)/s*.2)))}
function makeMod(){const r=rng(777),e=field(MOD_SIZE,r),w=field(MOD_SIZE,r),d=new Uint8Array(MOD_SIZE*MOD_SIZE*4);
 for(let i=0;i<e.length;i++){d[i*4]=Math.round(e[i]*255);d[i*4+1]=Math.round(w[i]*255);d[i*4+2]=128;d[i*4+3]=255}return d}
export const MOD=makeMod();   // R - wave-group envelope, G - phase shift (crest bending); tiles seamlessly

const m2=[0,0];
export function sampleMod(u,v){const M=MOD_SIZE,fx=(u-Math.floor(u))*M-.5,fy=(v-Math.floor(v))*M-.5,x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0;
 const xa=(x0+M)%M,xb=(x0+1+M)%M,ya=(y0+M)%M,yb=(y0+1+M)%M;
 for(let c=0;c<2;c++){const a=MOD[(ya*M+xa)*4+c],b=MOD[(ya*M+xb)*4+c],cc=MOD[(yb*M+xa)*4+c],d=MOD[(yb*M+xb)*4+c];
  m2[c]=((a+(b-a)*tx)*(1-ty)+(cc+(d-cc)*tx)*ty)/255}return m2}

/** Sea state. w1=(dx,dz,k,A) w2=(ω,φ,sAlong,sAcross) w3=(cg,offU,offV,warp) - exactly what the shader reads. */
export const sea={w1:new Float32Array(N*4),w2:new Float32Array(N*4),w3:new Float32Array(N*4),
 Us:U_REF,th:TH0,drift:{x:0,z:0},ratio:new Float32Array(N).fill(1)};

/** wind: {u10 - speed at 10 m, dir - wind direction (rad, in the x-z plane)}. */
export function updateSea(dt,wind){const S=sea;
 S.Us+=(wind.u10-S.Us)*(1-Math.exp(-dt/150));                       // the sea spins up over minutes
 let d=wind.dir-S.th;d=Math.atan2(Math.sin(d),Math.cos(d));S.th+=d*(1-Math.exp(-dt/70));
 S.drift.x=Math.cos(wind.dir)*.03*S.Us;S.drift.z=Math.sin(wind.dir)*.03*S.Us;   // drift current ~3% of wind (velocity, not accumulated)
 const wp4=(.877*G/S.Us)**4,wr4=(.877*G/U_REF)**4;
 for(let i=0;i<N;i++){
  let r=i<NMOD?Math.exp(-.625*(wp4-wr4)/OM[i]**4):Math.sqrt(S.Us/U_REF);   // sqrt(S_PM(ω;U)/S_PM(ω;Uref))
  r=i<NMOD?Math.min(2.2,Math.max(.45,r)):Math.min(1.5,Math.max(.6,r));S.ratio[i]=r;
  const a=S.th+OFF[i],o=i*4;
  S.w1[o]=Math.cos(a);S.w1[o+1]=Math.sin(a);S.w1[o+2]=K[i];S.w1[o+3]=A0[i]*r;
  S.w2[o]=OM[i];S.w2[o+1]=PH[i];S.w2[o+2]=SAL[i];S.w2[o+3]=SAC[i];
  S.w3[o]=CG[i];S.w3[o+1]=OU[i];S.w3[o+2]=OV[i];S.w3[o+3]=i<NMOD?WARP:0}}
updateSea(0,{u10:U_REF,dir:TH0});

/** Water height at (x,z) at time t. Mirror of the GLSL H() from shaders/ocean.js. */
export function hgt(x,z,t){let h=0;
 for(let i=0;i<NMOD;i++){const o=i*4,dx=sea.w1[o],dz=sea.w1[o+1],kd=x*dx+z*dz;
  const m=sampleMod((kd-sea.w3[o]*t)*sea.w2[o+2]+sea.w3[o+1],(z*dx-x*dz)*sea.w2[o+3]+sea.w3[o+2]);
  const s=.5+.5*Math.sin(sea.w1[o+2]*kd+sea.w2[o+1]+(m[1]-.5)*2*sea.w3[o+3]-sea.w2[o]*t);
  h+=sea.w1[o+3]*(.45+1.1*m[0])*(s*s*s-.3125)}
 return h}
