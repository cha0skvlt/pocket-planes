import * as THREE from 'three';
import {slim} from '../core/geometry.js';
import {skyVert,skyFrag} from '../shaders/sky.js';
export function createSky(S,fogU){
 const sky=new THREE.Mesh(slim(new THREE.SphereGeometry(1800,32,16)),new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,extensions:{derivatives:true},uniforms:fogU,vertexShader:skyVert,fragmentShader:skyFrag}));
 sky.renderOrder=-1;S.add(sky);
 return sky;
}
