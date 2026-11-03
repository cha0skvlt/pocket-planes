/** Audio: wind, ocean rumble and wave splash only (synthesized at runtime). */
export function createAudio(){
const rn=Math.random;let A=null,ns=0;
function build(){const c=new(window.AudioContext||window.webkitAudioContext)(),L=c.sampleRate*8,wb=c.createBuffer(1,L,c.sampleRate),bb=c.createBuffer(1,L,c.sampleRate),d=wb.getChannelData(0),b=bb.getChannelData(0);let l=0;
 for(let i=0;i<L;i++){const w=rn()*2-1;d[i]=w;l=(l+.02*w)/1.02;b[i]=l*3.5}
 for(let i=0;i<4000;i++){const k=i/4000;b[L-4000+i]=b[L-4000+i]*(1-k)+b[0]*k;d[L-4000+i]=d[L-4000+i]*(1-k)+d[0]*k}
 const m=c.createGain();m.gain.value=.9;const cp=c.createDynamicsCompressor();m.connect(cp);cp.connect(c.destination);
 const chain=(buf,type,fq,Q)=>{const s=c.createBufferSource();s.buffer=buf;s.loop=true;s.start();const f=c.createBiquadFilter();f.type=type;f.frequency.value=fq;f.Q.value=Q;const g=c.createGain();g.gain.value=0;s.connect(f);f.connect(g);g.connect(m);return{f,g}};
 A={c,buf:wb,m,wind:chain(wb,'bandpass',600,.7),howl:chain(wb,'bandpass',900,9),roar:chain(bb,'lowpass',240,.5),rum:chain(bb,'lowpass',70,.7)}}
function splash(v){const c=A.c,s=c.createBufferSource();s.buffer=A.buf;const f=c.createBiquadFilter();f.type='bandpass';f.frequency.value=500+rn()*2200;f.Q.value=.6;
 const g=c.createGain(),p=c.createStereoPanner?c.createStereoPanner():null,t=c.currentTime,len=.8+rn()*1.6;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+.05+rn()*.15);g.gain.exponentialRampToValueAtTime(.001,t+len);
 s.connect(f);f.connect(g);if(p){p.pan.value=rn()*2-1;g.connect(p);p.connect(A.m)}else g.connect(A.m);s.onended=()=>{s.disconnect();f.disconnect();g.disconnect();if(p)p.disconnect()};s.start(t,rn()*5,len+.1)}
function update(dt,t,sp,gust,alt,shk){
 if(A){const safe=v=>Number.isFinite(+v)?+v:0;  // WebAudio throws on non-finite — never let it
  sp=safe(sp);gust=safe(gust);alt=safe(alt);shk=safe(shk);
  const near=Math.exp(-alt/50),ct=A.c.currentTime,set=(p,v)=>p.setTargetAtTime(safe(v),ct,.15);
  set(A.wind.g.gain,.16+.012*sp+gust*.1);set(A.wind.f.frequency,350+sp*25+gust*300);set(A.howl.g.gain,.015+.004*sp+gust*.02);set(A.howl.f.frequency,700+gust*500+Math.sin(t*.7)*120);
  set(A.roar.g.gain,.5+.55*near+shk*.2);set(A.rum.g.gain,.7+.3*near);
  if((ns-=dt)<0){splash(.08+.5*near*rn()+shk*.2);ns=.2+rn()*1.2*(1.25-near*.6)}}
}
return {
 start(){if(!A)build();A.c.resume()},
 setSuspended(h){if(A)h?A.c.suspend():A.c.resume()},
 update,
 close(){if(A){A.c.close();A=null}}
};
}
