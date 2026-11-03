import * as THREE from 'three';
import {sea as seaJS,hgt as hgtJS} from '../sim/sea.js';
import {PP} from '../sim/pp.js';
// hgt: from WASM when available, otherwise the JS reference. Same interface as before.
export const hgt=(x,z,t)=>PP.ready?PP.hgt(x,z,t):hgtJS(x,z,t);
/** Bridges the sea model to the shader: uniform arrays and the tiled modulation texture.
 *  w1/w2/w3 come from either JS sea.js or the WASM PPState (see sim/pp.js): one interface. */
export const NZ=`float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+1.),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}`;
export function createSeaUniforms(seaSrc){
 const s=seaSrc||seaJS;
 const tex=new THREE.DataTexture(s.MOD,s.MOD_SIZE,s.MOD_SIZE,THREE.RGBAFormat);
 tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.magFilter=tex.minFilter=THREE.LinearFilter;tex.generateMipmaps=false;tex.needsUpdate=true;
 return {uniforms:{uW1:{value:s.w1},uW2:{value:s.w2},uW3:{value:s.w3},uMod:{value:tex},uDrift:{value:new THREE.Vector2()}},dispose(){tex.dispose()}};
}