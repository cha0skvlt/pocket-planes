/** Sky: procedural clouds on gradient noise, moon, halo. */
export const skyVert=`varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const skyFrag=`uniform float t,vis,flash;uniform vec3 fogC;uniform vec3 rift;varying vec3 vD;float G;uniform vec2 uCloud;
const mat3 RM=mat3(0.,.8,.6,-.8,.36,-.48,-.6,-.48,.64);
vec3 h33(vec3 p){p=fract(p*vec3(.1031,.103,.0973));p+=dot(p,p.yxz+33.33);return fract((p.xxy+p.yxx)*p.zyx);}
#define G3(o) dot(h33(i+(o))*2.-1.,f-(o))
float gn(vec3 p){vec3 i=floor(p),f=fract(p),u=f*f*f*(f*(f*6.-15.)+10.);
return .5+.68*mix(mix(mix(G3(vec3(0.)),G3(vec3(1.,0.,0.)),u.x),mix(G3(vec3(0.,1.,0.)),G3(vec3(1.,1.,0.)),u.x),u.y),mix(mix(G3(vec3(0.,0.,1.)),G3(vec3(1.,0.,1.)),u.x),mix(G3(vec3(0.,1.,1.)),G3(vec3(1.)),u.x),u.y),u.z);}
float fb(vec3 p,float cy){float a=.5,s=0.,ws=0.,ff=1.;for(int i=0;i<5;i++){float w=1.-smoothstep(.2,.45,cy*ff);s+=a*w*gn(p);ws+=a*w;p=RM*p*2.02+vec3(1.7,9.2,3.1);a*=.5;ff*=2.02;}return ws>.001?s/ws:.5;}
float fq(vec3 p){float a=.5,s=0.;for(int i=0;i<3;i++){s+=a*gn(p);p=RM*p*2.02+vec3(1.7,9.2,3.1);a*=.5;}return s/.875;}
float lay(vec2 b,vec2 q,float sc,float sp,float an,float wp,float z,float lo,float hi){vec2 u=b*sc-(mat2(cos(an),sin(an),-sin(an),cos(an))*uCloud)*sp+q*wp;float c=(fb(vec3(u,t*z),G*sc)-.5)*1.7+.5;return smoothstep(lo,hi,c);}
void main(){vec3 d=normalize(vD);float y=max(d.y,0.),k=1./(y+.14);vec2 b=d.xz*k;G=length(fwidth(b));
if(d.y<-.04){gl_FragColor=vec4(fogC,1.);return;}
float an=0.;
vec2 q=vec2(fq(vec3(b*.3+vec2(t*.004,0.),t*.025)),fq(vec3(b*.3+vec2(7.3,t*.003),t*.025+4.)))-.5;
float dm=dot(d,rift),h1=max(1.-dm,0.),ang=sqrt(2.*h1);vec3 lc=vec3(.62,.7,.82);
float mk=1.-smoothstep(.05,.75,ang+(fq(vec3(b*.7+vec2(t*.01,0.),t*.03+9.))-.5)*.9),cl=mk*vis;
vec3 col=mix(vec3(.12,.135,.155),vec3(.045,.05,.065),smoothstep(0.,.6,y));
vec3 e1=normalize(cross(rift,vec3(0.,1.,0.))),e2=cross(e1,rift);
const float mr=.05;float cr=cos(mr),ew=fwidth(dm)*1.2+1e-6,disc=smoothstep(cr-ew,cr+ew,dm);
vec2 mp=vec2(dot(d,e1),dot(d,e2))/sin(mr);float z=sqrt(max(1.-dot(mp,mp),0.));
float mar=smoothstep(.46,.6,fq(vec3(mp*1.8+3.,1.)));
float lit=smoothstep(-.2,.4,dot(normalize(vec3(mp,z+.001)),normalize(vec3(.55,.25,.8))));
vec3 ms=vec3(.88,.9,.93)*(1.-.4*mar)*(.88+.24*gn(vec3(mp*12.,5.)))*(.5+.5*z)*lit*1.8+vec3(.015,.02,.03);
col+=lc*(.2/(1.+h1*1400.)+.07/(1.+h1*90.)+.035/(1.+h1*7.));
col=mix(col,ms,disc);
#define CL(x) clamp((x)*(1.-.92*cl)+(1.-vis)*mk*.9,0.,1.)
float dA=lay(b,q,.45,.007,an,1.2,.02,.4,.85)*(1.-.8*cl);
col=mix(col,vec3(.09,.1,.12)+lc*.5/(1.+h1*25.)*(1.-dA*.3),dA*.55);
vec2 ld=normalize(rift.xz/(rift.y+.14)-b+1e-4);
float dB=CL(lay(b,q,.9,.016,an+.25,1.7,.035,.4,.74)),dB2=CL(lay(b+ld*.22,q,.9,.016,an+.25,1.7,.035,.4,.74));
float tl=exp(-dB2*2.4),edge=dB*(1.-dB)*4.;
vec3 cB=mix(vec3(.018,.02,.025),vec3(.2,.215,.23),tl*tl)*(.7+.3*vis);
cB+=lc*edge*tl*(.9/(1.+h1*18.)+.1);cB+=vec3(.5,.58,.75)*flash*(.25+.75*gn(vec3(b*1.4,t*.8)))*.7;
col=mix(col,cB,dB);
float dC=lay(b,q,1.8,.05,an+.5,2.4,.07,.5,.8)*smoothstep(.5,.02,y);
col=mix(col,vec3(.055,.06,.07)+lc*.3/(1.+h1*30.),dC*.75);
col=mix(fogC,col,smoothstep(0.,.3,d.y));gl_FragColor=vec4(col,1.);}`;
