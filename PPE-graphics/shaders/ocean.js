import {NZ} from '../world/waves.js';
/* Waves read the uniform arrays from sim/sea.js. W1=(dx,dz,k,A) W2=(ω,φ,sAlong,sAcross) W3=(cg,offU,offV,warp). Change formulas in sync with sim/sea.js. */
const SEA=`precision highp sampler2D;uniform vec4 uW1[7],uW2[7],uW3[7];uniform sampler2D uMod;
vec2 modAt(int i,vec2 p,float t){vec4 a=uW1[i],c=uW2[i],o=uW3[i];return texture2D(uMod,vec2((dot(p,a.xy)-o.x*t)*c.z+o.y,(p.y*a.x-p.x*a.y)*c.w+o.z)).rg;}`;
const H5=`float H(vec2 p,float t){float h=0.;for(int i=0;i<5;i++){vec4 a=uW1[i],c=uW2[i],o=uW3[i];vec2 m=modAt(i,p,t);
float s=.5+.5*sin(a.z*dot(a.xy,p)+c.y+(m.y-.5)*2.*o.w-c.x*t);h+=a.w*(.45+1.1*m.x)*(s*s*s-.3125);}return h;}`;
const HD3=`vec3 HD3(vec2 p,float e,float t){vec3 h=vec3(0.);vec2 pb=p+vec2(e,0.),pc=p+vec2(0.,e);
for(int i=0;i<7;i++){vec4 a=uW1[i],c=uW2[i],o=uW3[i];vec2 m=vec2(.5);if(i<5)m=modAt(i,p,t);
float b=c.y+(m.y-.5)*2.*o.w-c.x*t,am=a.w*(.45+1.1*m.x);vec3 s=.5+.5*sin(vec3(dot(a.xy,p),dot(a.xy,pb),dot(a.xy,pc))*a.z+b);h+=am*(s*s*s-.3125);}return h;}`;
/** Ocean: Gerstner-like waves, foam, moon trail. */
export const oceanVert=`uniform float t;varying vec3 vW;${SEA}${H5}void main(){vec4 w=modelMatrix*vec4(position,1.);w.y+=H(w.xz,t);vW=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}`;
export const oceanFrag=`uniform float t,vis;uniform vec2 uDrift;uniform vec3 fogC;uniform vec3 rift;varying vec3 vW;${SEA}${HD3}${NZ}
void main(){vec2 p=vW.xz;float e=.4;vec3 H3=HD3(p,e,t);float h=H3.x,hx=H3.y,hz=H3.z;
vec3 N=normalize(vec3(h-hx,e,h-hz));vec3 V=cameraPosition-vW;float d=length(V);V/=d;
N=normalize(mix(N,vec3(0.,1.,0.),smoothstep(120.,520.,d)*.7));
float fr=.04+.96*pow(1.-max(dot(N,V),0.),4.);vec3 R=reflect(-V,N);R.y=abs(R.y);
vec3 sk=mix(fogC,vec3(.05,.055,.06),smoothstep(0.,.45,R.y));sk+=vec3(.5,.58,.7)*pow(max(dot(R,rift),0.),10.)*.9*(.25+.75*vis);
float crest=smoothstep(.5,5.,h);vec3 base=mix(vec3(.006,.02,.024),vec3(.03,.1,.1),crest)*(.6+.4*N.y);
vec3 col=base+sk*fr*.85;col+=vec3(.75,.85,1.)*(pow(max(dot(R,rift),0.),220.)*2.+pow(max(dot(R,rift),0.),1800.)*5.)*vis;
float fm=crest*.9+(1.-N.y)*2.2+vn((p-uDrift)*.5)*.35+vn((p-uDrift*1.2)*2.1)*.2-.95;fm=smoothstep(0.,.55,fm);
col=mix(col,vec3(.36,.4,.42)*(.7+.3*vn(p*3.)),fm*.85);
float f=1.-exp(-pow(d*.0028,2.));f=max(f,smoothstep(320.,480.,d));gl_FragColor=vec4(mix(col,fogC,f),1.);}`;
