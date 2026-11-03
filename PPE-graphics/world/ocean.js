import * as THREE from 'three';
import {slim} from '../core/geometry.js';
import {oceanVert,oceanFrag} from '../shaders/ocean.js';
export function createOcean(S,fogU,seaU){
 const ocean=new THREE.Mesh(slim(new THREE.PlaneGeometry(1000,1000,400,400).rotateX(-Math.PI/2)),new THREE.ShaderMaterial({uniforms:{...fogU,...seaU},vertexShader:oceanVert,fragmentShader:oceanFrag}));
 ocean.frustumCulled=false;S.add(ocean);
 return ocean;
}
