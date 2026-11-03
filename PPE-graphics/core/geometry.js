/** Strips unused normal/uv attributes (memory savings for shader meshes). */
export const slim=g=>{g.deleteAttribute('normal');g.deleteAttribute('uv');return g};
