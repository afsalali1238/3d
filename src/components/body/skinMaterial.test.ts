import { describe, expect, it } from 'vitest';
import { ShaderChunk, ShaderLib, Vector3 } from 'three';
import { createSkinMaterial } from './skinMaterial';

describe('skinMaterial shader patch', () => {
  it('patches the current three.js physical shader and reports that state', () => {
    const handle = createSkinMaterial('#00d4a8');
    const shader: any = {
      vertexShader: ShaderLib.physical.vertexShader,
      fragmentShader: ShaderLib.physical.fragmentShader,
      uniforms: { ...ShaderLib.physical.uniforms },
    };

    handle.material.onBeforeCompile(shader, {} as any);

    expect(handle.patched).toBe(true);
    expect(shader.vertexShader).toContain('attribute float _ao;');
    expect(shader.vertexShader).toContain('vBvReg = floor( _regionid + 0.5 );');
    expect(shader.fragmentShader).toContain('vec3 bvWrapNL');
    expect(shader.fragmentShader).toContain('bvPerturbNormal');
    expect(shader.uniforms.uPoreStrength.value).toBeGreaterThan(0);
    expect((handle.material as any).defaultAttributeValues._ao).toEqual([0]);
  });

  it('falls back cleanly if shader anchors move', () => {
    const handle = createSkinMaterial();
    const shader: any = {
      vertexShader: 'void main() { gl_Position = vec4(0.0); }',
      fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
      uniforms: {},
    };

    handle.material.onBeforeCompile(shader, {} as any);

    expect(handle.patched).toBe(false);
    expect(shader.uniforms.uPoreStrength).toBeUndefined();
  });

  it('keeps the key-light uniform mutable for camera-space SSS updates', () => {
    const handle = createSkinMaterial();
    handle.uniforms.uKeyLightDirView.value.copy(new Vector3(1, 2, 3).normalize());
    expect(handle.uniforms.uKeyLightDirView.value.length()).toBeCloseTo(1);
  });

  it('guards the exact direct-light chunk we replace', () => {
    expect(ShaderChunk.lights_physical_pars_fragment).toContain(
      'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;',
    );
  });
});
