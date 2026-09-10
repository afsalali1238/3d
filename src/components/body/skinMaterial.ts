/**
 * Patched physically-based skin material.
 *
 * Realism strategy (all cheap enough for mobile):
 *  - wrap-lighting diffuse (dot(N,L) remapped) so terminators are soft, not CG-hard
 *  - fresnel backscatter subsurface term tinted warm, driven by a baked
 *    per-vertex thickness attribute (ears / fingers / nose glow when backlit)
 *  - fresnel rim light for silhouette separation
 *  - procedural value-noise breakup of albedo + roughness (the asset ships
 *    without texture maps; when a textured GLB is swapped in, the maps simply
 *    multiply on top — see ASSET-SPEC.md)
 *  - region highlight / hover / dim-others evaluated in-shader from the
 *    _REGIONID vertex attribute: single mesh, single draw call, no second
 *    outline pass, no z-fighting.
 *
 * The whole patch is guarded: if any anchor string is missing (e.g. a future
 * three.js upgrade), we skip the patch and fall back to plain PBR instead of
 * risking a black screen.
 */
import {
  Color,
  MeshPhysicalMaterial,
  ShaderChunk,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export type SkinUniforms = {
  uActiveRegion: { value: number };
  uHoverRegion: { value: number };
  uHoverStrength: { value: number };
  uTime: { value: number };
  uHighlightColor: { value: Color };
  uDimOthers: { value: number };
  uWrap: { value: number };
  uSSSColor: { value: Color };
  uSSSIntensity: { value: number };
  uRimColor: { value: Color };
  uRimStrength: { value: number };
  uKeyLightDirView: { value: Vector3 };
};

export type SkinMaterialHandle = {
  material: MeshPhysicalMaterial;
  uniforms: SkinUniforms;
  /** true if the SSS/highlight patch compiled in; false = plain PBR fallback */
  patched: boolean;
};

const ACCENT = '#00d4a8';

export function createSkinMaterial(accent: string = ACCENT): SkinMaterialHandle {
  const uniforms: SkinUniforms = {
    uActiveRegion: { value: -1 },
    uHoverRegion: { value: -1 },
    uHoverStrength: { value: 0.3 },
    uTime: { value: 0 },
    uHighlightColor: { value: new Color(accent) },
    uDimOthers: { value: 0 },
    uWrap: { value: 0.4 },
    uSSSColor: { value: new Color('#c74a3a') },
    uSSSIntensity: { value: 0.4 },
    uRimColor: { value: new Color('#ffe9d8') },
    uRimStrength: { value: 0.16 },
    uKeyLightDirView: { value: new Vector3(0.5, 0.5, 0.7) },
  };

  const material = new MeshPhysicalMaterial({
    color: new Color('#c28e76'),
    roughness: 0.55,
    metalness: 0.0,
    clearcoat: 0.0,
    sheen: 0.25,
    sheenColor: new Color('#ffd9c2'),
    sheenRoughness: 0.6,
  });

  let patched = false;

  const VERT_COMMON = '#include <common>';
  const VERT_BEGIN = '#include <begin_vertex>';
  const FRAG_COMMON = '#include <common>';
  const FRAG_DIFFUSE = 'vec4 diffuseColor = vec4( diffuse, opacity );';
  const FRAG_ROUGH = '#include <roughnessmap_fragment>';
  const FRAG_OUT = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';
  const LIGHTS_INCLUDE = '#include <lights_physical_pars_fragment>';
  const DOTNL = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    try {
      const lightsChunk = ShaderChunk.lights_physical_pars_fragment as string;
      const ok =
        shader.vertexShader.includes(VERT_COMMON) &&
        shader.vertexShader.includes(VERT_BEGIN) &&
        shader.fragmentShader.includes(FRAG_COMMON) &&
        shader.fragmentShader.includes(FRAG_DIFFUSE) &&
        shader.fragmentShader.includes(FRAG_ROUGH) &&
        shader.fragmentShader.includes(FRAG_OUT) &&
        shader.fragmentShader.includes(LIGHTS_INCLUDE) &&
        lightsChunk.includes(DOTNL);
      if (!ok) {
        console.warn('[BodyViewer] skin shader anchors missing — using plain PBR fallback');
        return;
      }

      Object.assign(shader.uniforms, uniforms);

      shader.vertexShader = shader.vertexShader
        .replace(
          VERT_COMMON,
          /* glsl */ `${VERT_COMMON}
          attribute float _regionid;
          attribute float _thickness;
          uniform float uActiveRegion;
          uniform float uHoverRegion;
          varying float vBvSel;
          varying float vBvHov;
          varying float vBvThick;
          varying vec3 vBvObjPos;`,
        )
        .replace(
          VERT_BEGIN,
          /* glsl */ `${VERT_BEGIN}
          vBvSel = ( abs( _regionid - uActiveRegion ) < 0.5 ) ? 1.0 : 0.0;
          vBvHov = ( abs( _regionid - uHoverRegion ) < 0.5 ) ? 1.0 : 0.0;
          vBvThick = _thickness;
          vBvObjPos = transformed;`,
        );

      // wrap-lighting: soften the diffuse terminator inside RE_Direct_Physical
      const wrappedLights = lightsChunk.replace(
        DOTNL,
        /* glsl */ `float bvRawNL = dot( geometryNormal, directLight.direction );
        float dotNL = saturate( ( bvRawNL + uWrap ) / ( 1.0 + uWrap ) );`,
      );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          FRAG_COMMON,
          /* glsl */ `${FRAG_COMMON}
          uniform float uTime;
          uniform vec3 uHighlightColor;
          uniform float uDimOthers;
          uniform float uHoverStrength;
          uniform float uWrap;
          uniform vec3 uSSSColor;
          uniform float uSSSIntensity;
          uniform vec3 uRimColor;
          uniform float uRimStrength;
          uniform vec3 uKeyLightDirView;
          varying float vBvSel;
          varying float vBvHov;
          varying float vBvThick;
          varying vec3 vBvObjPos;
          float bvHash( vec3 p ) {
            return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453123 );
          }
          float bvNoise( vec3 p ) {
            vec3 i = floor( p );
            vec3 f = fract( p );
            f = f * f * ( 3.0 - 2.0 * f );
            float n000 = bvHash( i );
            float n100 = bvHash( i + vec3( 1.0, 0.0, 0.0 ) );
            float n010 = bvHash( i + vec3( 0.0, 1.0, 0.0 ) );
            float n110 = bvHash( i + vec3( 1.0, 1.0, 0.0 ) );
            float n001 = bvHash( i + vec3( 0.0, 0.0, 1.0 ) );
            float n101 = bvHash( i + vec3( 1.0, 0.0, 1.0 ) );
            float n011 = bvHash( i + vec3( 0.0, 1.0, 1.0 ) );
            float n111 = bvHash( i + vec3( 1.0, 1.0, 1.0 ) );
            return mix(
              mix( mix( n000, n100, f.x ), mix( n010, n110, f.x ), f.y ),
              mix( mix( n001, n101, f.x ), mix( n011, n111, f.x ), f.y ),
              f.z );
          }`,
        )
        .replace(LIGHTS_INCLUDE, wrappedLights)
        .replace(
          FRAG_DIFFUSE,
          /* glsl */ `${FRAG_DIFFUSE}
          {
            // warm shift on thin features (ears, fingers, nose) + redder
            // knees/elbows/hands via thickness, and mottled albedo breakup
            float bvThin = 1.0 - smoothstep( 0.004, 0.06, vBvThick );
            diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.08, 0.82, 0.76 ), bvThin * 0.45 );
            float bvMottle = bvNoise( vBvObjPos * 55.0 ) * 0.65 + bvNoise( vBvObjPos * 190.0 ) * 0.35;
            diffuseColor.rgb *= 0.965 + 0.07 * bvMottle;
          }`,
        )
        .replace(
          FRAG_ROUGH,
          /* glsl */ `${FRAG_ROUGH}
          {
            // skin roughness lives in ~0.45–0.65: glossier on thin/bony areas,
            // drier elsewhere, with fine pore-scale variation
            float bvPore = bvNoise( vBvObjPos * 260.0 );
            float bvThinR = 1.0 - smoothstep( 0.004, 0.06, vBvThick );
            roughnessFactor = clamp( roughnessFactor * ( 0.9 + 0.2 * bvPore ) - bvThinR * 0.08, 0.42, 0.68 );
          }`,
        )
        .replace(
          FRAG_OUT,
          /* glsl */ `${FRAG_OUT}
          {
            vec3 bvV = normalize( vViewPosition );
            vec3 bvN = normalize( normal );
            vec3 bvL = normalize( uKeyLightDirView );
            float bvFres = pow( 1.0 - saturate( dot( bvN, bvV ) ), 3.0 );
            // approximated subsurface: light leaking through thin features.
            // Clamped so it can never blow past the bloom threshold.
            float bvBack = pow( saturate( dot( bvV, -normalize( bvL + bvN * 0.35 ) ) ), 1.6 );
            float bvThin = 1.0 - smoothstep( 0.008, 0.055, vBvThick );
            vec3 bvSSS = uSSSColor * uSSSIntensity * ( bvBack * 0.75 + 0.25 ) * bvThin
              * saturate( totalDiffuse.g * 1.6 );
            outgoingLight += min( bvSSS, vec3( 0.28 ) );
            // rim light for silhouette separation
            outgoingLight += uRimColor * bvFres * uRimStrength;
            // hard ceiling at 1.0: the composer's bloom threshold sits just
            // above, so bare skin can never bloom — only the highlight glow
            // (added below) and the unclamped pin markers can
            outgoingLight = min( outgoingLight, vec3( 1.0 ) );
            // sharpen the interpolated region membership so the highlight
            // follows the label boundary instead of smearing across it
            float bvSelS = smoothstep( 0.38, 0.62, vBvSel );
            float bvHovS = smoothstep( 0.38, 0.62, vBvHov );
            // dim + desaturate everything except the active region
            float bvGrey = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
            vec3 bvDimmed = mix( outgoingLight, vec3( bvGrey ), 0.35 ) * 0.55;
            outgoingLight = mix( outgoingLight, bvDimmed, uDimOthers * ( 1.0 - bvSelS ) );
            // active region: pulsing emissive tint + rim boost, hover at 30%.
            // Blend-toward-accent keeps the hue teal instead of washing to
            // yellow, then a small additive kick lets the fresnel edge bloom.
            float bvPulse = 0.25 + 0.25 * ( 0.5 + 0.5 * sin( uTime * 5.2359878 ) );
            float bvGlow = bvSelS * bvPulse + bvHovS * ( 1.0 - bvSelS ) * uHoverStrength * 0.55;
            outgoingLight = mix( outgoingLight, uHighlightColor * ( 0.55 + bvGrey * 0.8 ), bvGlow * 1.35 );
            outgoingLight += uHighlightColor * bvGlow * bvFres * 0.9;
          }`,
        );
      patched = true;
    } catch (err) {
      console.warn('[BodyViewer] skin shader patch failed — plain PBR fallback', err);
    }
  };
  material.customProgramCacheKey = () => 'bodyviewer-skin-v1';

  return { material, uniforms, patched };
}
