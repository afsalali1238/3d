/**
 * Patched physically-based skin material.
 *
 * The shipped body GLB has no UVs and no texture maps (ASSET-SPEC.md), so
 * everything that makes it read as skin instead of plastic is computed here,
 * from four baked vertex channels — `_REGIONID`, `_THICKNESS`, `_AO`,
 * `_CURV` — plus one small procedurally generated detail map
 * (./skinDetail.ts, triplanar, no download).
 *
 * Realism model (all cheap enough for mobile):
 *  - three-lobe diffuse scattering: the R/G/B diffuse terminators wrap by
 *    different amounts (0.55 / 0.28 / 0.20), which is the cheap stand-in for a
 *    Burley skin profile — light bleeds red past the terminator instead of
 *    ending on a hard CG line
 *  - transmission/backscatter through thin parts (ears, fingers, nose),
 *    driven by the baked `_THICKNESS` channel
 *  - baked hemispherical AO (`_AO`) modulating indirect diffuse/specular, plus
 *    curvature-derived cavity darkening in creases (`_CURV`) — armpits, groin,
 *    the neck fold, between the fingers
 *  - curvature-boosted scattering on convex edges, the way real skin glows
 *    where it is thin and rounded
 *  - triplanar micro-detail: pore/orange-peel normals, pore-cavity roughness
 *    breakup and low-frequency dermal mottle in the albedo
 *  - dual specular response: a broad rough lobe from the base material plus a
 *    tight low-F0 (2.8 %, skin's real IOR) sheen lobe, so highlights look wet
 *    rather than plastic
 *  - region highlight / hover / dim-others evaluated in-shader from the
 *    `_REGIONID` vertex attribute: single mesh, single draw call, no second
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
  type Texture,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { getSkinDetailTexture } from './skinDetail';

export type SkinUniforms = {
  uActiveRegion: { value: number };
  uHoverRegion: { value: number };
  uHoverStrength: { value: number };
  uTime: { value: number };
  uHighlightColor: { value: Color };
  uDimOthers: { value: number };
  uWrapRGB: { value: Vector3 };
  uSSSColor: { value: Color };
  uSSSIntensity: { value: number };
  uRimColor: { value: Color };
  uRimStrength: { value: number };
  uKeyLightDirView: { value: Vector3 };
  uDetailMap: { value: Texture | null };
  uDetailScale: { value: number };
  uDetailStrength: { value: number };
  uMacroScale: { value: number };
  uAOStrength: { value: number };
  uCavityStrength: { value: number };
  uSpecTint: { value: Color };
};

export type SkinMaterialHandle = {
  material: MeshPhysicalMaterial;
  uniforms: SkinUniforms;
  /**
   * true once the SSS/highlight patch has been injected; false = plain PBR
   * fallback. Read it *after* the first render — `onBeforeCompile` runs when
   * three first compiles the program, not when the material is created (it is
   * a getter for exactly that reason).
   */
  readonly patched: boolean;
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
    // per-channel diffuse wrap — red scatters furthest through skin
    uWrapRGB: { value: new Vector3(0.55, 0.28, 0.2) },
    uSSSColor: { value: new Color('#a84538') },
    uSSSIntensity: { value: 0.26 },
    uRimColor: { value: new Color('#ffe3cd') },
    uRimStrength: { value: 0.13 },
    uKeyLightDirView: { value: new Vector3(0.5, 0.5, 0.7) },
    uDetailMap: { value: null },
    // ~1 tile per 9 cm of skin → pores land around 0.4 mm
    uDetailScale: { value: 11.0 },
    uDetailStrength: { value: 0.35 },
    uMacroScale: { value: 4.5 },
    uAOStrength: { value: 0.9 },
    uCavityStrength: { value: 0.55 },
    uSpecTint: { value: new Color('#fff1e4') },
  };

  try {
    uniforms.uDetailMap.value = getSkinDetailTexture();
  } catch (err) {
    console.warn('[BodyViewer] skin detail texture unavailable', err);
  }

  const material = new MeshPhysicalMaterial({
    color: new Color('#c99e8f'),
    roughness: 0.52,
    metalness: 0.0,
    // skin's real Fresnel reflectance is ~2.8 %, not the 4 % PBR default —
    // this single number is most of the difference between skin and plastic
    specularIntensity: 0.7,
    specularColor: new Color('#fff2e6'),
    clearcoat: 0.0,
    sheen: 0.35,
    sheenColor: new Color('#ffd3ba'),
    sheenRoughness: 0.55,
  });

  let patched = false;

  const VERT_COMMON = '#include <common>';
  const VERT_BEGIN = '#include <begin_vertex>';
  const FRAG_COMMON = '#include <common>';
  const FRAG_DIFFUSE = 'vec4 diffuseColor = vec4( diffuse, opacity );';
  const FRAG_ROUGH = '#include <roughnessmap_fragment>';
  const FRAG_NORMAL = '#include <normal_fragment_maps>';
  const FRAG_AO = '#include <aomap_fragment>';
  const FRAG_OUT = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';
  const LIGHTS_INCLUDE = '#include <lights_physical_pars_fragment>';
  const DOTNL = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );';
  const DIRECT_DIFFUSE =
    'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );';

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    try {
      const lightsChunk = ShaderChunk.lights_physical_pars_fragment as string;
      const ok =
        shader.vertexShader.includes(VERT_COMMON) &&
        shader.vertexShader.includes(VERT_BEGIN) &&
        shader.fragmentShader.includes(FRAG_COMMON) &&
        shader.fragmentShader.includes(FRAG_DIFFUSE) &&
        shader.fragmentShader.includes(FRAG_ROUGH) &&
        shader.fragmentShader.includes(FRAG_NORMAL) &&
        shader.fragmentShader.includes(FRAG_AO) &&
        shader.fragmentShader.includes(FRAG_OUT) &&
        shader.fragmentShader.includes(LIGHTS_INCLUDE) &&
        lightsChunk.includes(DOTNL) &&
        lightsChunk.includes(DIRECT_DIFFUSE);
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
          attribute float _ao;
          attribute float _curv;
          uniform float uActiveRegion;
          uniform float uHoverRegion;
          varying float vBvSel;
          varying float vBvHov;
          varying float vBvThick;
          varying float vBvAO;
          varying float vBvCurv;
          varying vec3 vBvObjPos;
          varying vec3 vBvObjNormal;`,
        )
        .replace(
          VERT_BEGIN,
          /* glsl */ `${VERT_BEGIN}
          vBvSel = ( abs( _regionid - uActiveRegion ) < 0.5 ) ? 1.0 : 0.0;
          vBvHov = ( abs( _regionid - uHoverRegion ) < 0.5 ) ? 1.0 : 0.0;
          vBvThick = _thickness;
          vBvAO = _ao;
          vBvCurv = _curv;
          vBvObjPos = transformed;
          vBvObjNormal = objectNormal;`,
        );

      // ---- diffuse scattering: per-channel wrap + forward scatter ---------
      // Skin does not have one diffuse terminator, it has three: red light
      // travels furthest under the surface, so the shadow line goes warm
      // before it goes dark. `bvScatter` collects the extra red bleed and the
      // through-the-ear transmission for every light, shadows included
      // (directLight.color is already shadow-attenuated here).
      const wrappedLights = lightsChunk
        .replace(
          DOTNL,
          /* glsl */ `float bvRawNL = dot( geometryNormal, directLight.direction );
        float dotNL = saturate( bvRawNL );`,
        )
        .replace(
          DIRECT_DIFFUSE,
          /* glsl */ `{
          // per-channel wrapped diffuse: red light keeps travelling under the
          // surface past the terminator, so the shadow line goes warm first
          vec3 bvWrapNL = saturate( ( vec3( bvRawNL ) + uWrapRGB ) / ( vec3( 1.0 ) + uWrapRGB ) );
          reflectedLight.directDiffuse += bvWrapNL * directLight.color * BRDF_Lambert( material.diffuseColor );
          // warm bleed right at the terminator, strongest on thin convex skin
          float bvTerm = smoothstep( 0.5, -0.25, bvRawNL ) * smoothstep( -0.7, -0.05, bvRawNL );
          bvScatter += directLight.color * uSSSColor * ( bvTerm * bvScatterGain );
          // transmission: light entering the far side and leaving toward the eye
          float bvTrans = pow( saturate( dot( geometryViewDir, -normalize( directLight.direction + geometryNormal * 0.4 ) ) ), 2.5 );
          bvScatter += directLight.color * uSSSColor * ( bvTrans * bvTransGain );
        }`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          FRAG_COMMON,
          /* glsl */ `${FRAG_COMMON}
          uniform float uTime;
          uniform vec3 uHighlightColor;
          uniform float uDimOthers;
          uniform float uHoverStrength;
          uniform vec3 uWrapRGB;
          uniform vec3 uSSSColor;
          uniform float uSSSIntensity;
          uniform vec3 uRimColor;
          uniform float uRimStrength;
          uniform vec3 uKeyLightDirView;
          uniform sampler2D uDetailMap;
          uniform float uDetailScale;
          uniform float uDetailStrength;
          uniform float uMacroScale;
          uniform float uAOStrength;
          uniform float uCavityStrength;
          uniform vec3 uSpecTint;
          varying float vBvSel;
          varying float vBvHov;
          varying float vBvThick;
          varying float vBvAO;
          varying float vBvCurv;
          varying vec3 vBvObjPos;
          varying vec3 vBvObjNormal;

          // globals filled in below and consumed inside RE_Direct_Physical
          vec3 bvScatter = vec3( 0.0 );
          float bvScatterGain = 0.0;
          float bvTransGain = 0.0;
          vec4 bvDetail = vec4( 0.5, 0.5, 1.0, 0.5 );
          float bvCavity = 1.0;
          float bvOcclusion = 1.0;

          // triplanar fetch of the procedural detail map
          vec4 bvTriplanar( vec3 p, vec3 n, float scale ) {
            vec3 w = pow( abs( n ), vec3( 4.0 ) );
            w /= max( w.x + w.y + w.z, 1e-4 );
            vec4 cx = texture2D( uDetailMap, p.zy * scale );
            vec4 cy = texture2D( uDetailMap, p.xz * scale );
            vec4 cz = texture2D( uDetailMap, p.xy * scale );
            return cx * w.x + cy * w.y + cz * w.z;
          }`,
        )
        .replace(LIGHTS_INCLUDE, wrappedLights)
        .replace(
          FRAG_DIFFUSE,
          /* glsl */ `${FRAG_DIFFUSE}
          {
            bvDetail = bvTriplanar( vBvObjPos, normalize( vBvObjNormal ), uDetailScale );
            vec4 bvMacro = bvTriplanar( vBvObjPos, normalize( vBvObjNormal ), uMacroScale );

            // creases read as cavities: baked concavity + pore mask
            float bvCrease = smoothstep( 0.0, -0.55, vBvCurv );
            bvCavity = mix( 1.0, bvDetail.b * 0.55 + 0.45, 0.85 ) * ( 1.0 - bvCrease * uCavityStrength );
            bvOcclusion = clamp( mix( 1.0, vBvAO, uAOStrength ) * bvCavity, 0.0, 1.0 );

            // thin, translucent parts (ears, fingers, nose, lips) run warmer
            float bvThin = 1.0 - smoothstep( 0.004, 0.055, vBvThick );
            diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 1.1, 0.82, 0.76 ), bvThin * 0.35 );

            // dermal mottle: large melanin/blood variation + fine pore breakup
            float bvMottle = bvMacro.a * 0.72 + bvDetail.a * 0.28;
            diffuseColor.rgb *= 0.989 + 0.022 * bvMottle;
            diffuseColor.rgb *= mix( 0.975, 1.0, bvDetail.b );

            // occluded skin goes warm and saturated, not grey — blood pooling
            // in creases is what sells armpits, groins and finger webs. A hue
            // shift, not a flat red wash on top.
            float bvShade = 1.0 - bvOcclusion;
            diffuseColor.rgb *= vec3( 1.0 ) + vec3( 0.03, -0.10, -0.16 ) * ( bvShade * 0.8 );

            // feed the direct-lighting scatter terms
            bvScatterGain = uSSSIntensity * ( 0.35 + 0.65 * smoothstep( -0.1, 0.45, vBvCurv ) ) * mix( 0.55, 1.0, bvOcclusion );
            bvTransGain = uSSSIntensity * bvThin * 0.85;
          }`,
        )
        .replace(
          FRAG_ROUGH,
          /* glsl */ `${FRAG_ROUGH}
          {
            // skin roughness lives in ~0.4–0.65: glossier on stretched, thin,
            // oily areas (nose, forehead, shins), drier in the pores
            float bvThinR = 1.0 - smoothstep( 0.004, 0.06, vBvThick );
            float bvPore = bvDetail.b;
            roughnessFactor = clamp(
              roughnessFactor * ( 1.06 - 0.16 * bvPore ) - bvThinR * 0.06 + ( 1.0 - bvOcclusion ) * 0.08,
              0.36, 0.72 );
          }`,
        )
        .replace(
          FRAG_NORMAL,
          /* glsl */ `${FRAG_NORMAL}
          {
            // perturb by the triplanar pore/orange-peel field. The detail map
            // stores a tangent-space normal; we rebuild an object-space
            // gradient from it without needing UVs or a tangent frame.
            vec3 bvGradObj = vec3( bvDetail.r - 0.5, bvDetail.g - 0.5, 0.0 ) * 2.0;
            vec3 bvN = normalize( vBvObjNormal );
            vec3 bvUp = abs( bvN.y ) < 0.95 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
            vec3 bvT = normalize( cross( bvUp, bvN ) );
            vec3 bvB = cross( bvN, bvT );
            vec3 bvOffset = ( bvT * bvGradObj.x + bvB * bvGradObj.y ) * uDetailStrength;
            // normalMatrix is orthonormal for this mesh, so transforming the
            // offset keeps its length — and unlike normalize() it cannot NaN
            // when the detail gradient is exactly zero
            normal = normalize( normal + normalMatrix * bvOffset );
          }`,
        )
        .replace(
          FRAG_AO,
          /* glsl */ `${FRAG_AO}
          {
            // baked hemispherical AO + cavity, applied the way an aoMap would be
            reflectedLight.indirectDiffuse *= bvOcclusion;
            float bvDotNV = saturate( dot( geometryNormal, geometryViewDir ) );
            reflectedLight.indirectSpecular *= computeSpecularOcclusion( bvDotNV, bvOcclusion, material.roughness );
            #ifdef USE_SHEEN
              sheenSpecularIndirect *= bvOcclusion;
            #endif
            // contact darkening also affects direct light a little: geometry
            // this soft never gets fully lit inside a crease
            float bvDirectOcc = mix( 1.0, bvOcclusion, 0.45 );
            reflectedLight.directDiffuse *= bvDirectOcc;
            reflectedLight.directSpecular *= bvDirectOcc;
          }`,
        )
        .replace(
          FRAG_OUT,
          /* glsl */ `${FRAG_OUT}
          {
            vec3 bvV = normalize( vViewPosition );
            vec3 bvN = normalize( normal );
            float bvFres = pow( 1.0 - saturate( dot( bvN, bvV ) ), 4.0 );

            // subsurface accumulated per light, tinted by how thin the skin is
            outgoingLight += min( bvScatter * diffuseColor.rgb * 2.2, vec3( 0.35 ) ) * bvOcclusion;

            // rim: keeps the silhouette readable against the dark backdrop
            outgoingLight += uRimColor * bvFres * uRimStrength * mix( 0.35, 1.0, bvOcclusion );

            // tight secondary specular lobe (the oily top layer of skin)
            vec3 bvL = normalize( uKeyLightDirView );
            vec3 bvH = normalize( bvL + bvV );
            float bvNH = saturate( dot( bvN, bvH ) );
            float bvTight = pow( bvNH, 220.0 ) * 0.14 * ( 1.0 - roughnessFactor ) * bvOcclusion;
            outgoingLight += uSpecTint * bvTight;

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
  material.customProgramCacheKey = () => 'bodyviewer-skin-v2';

  return {
    material,
    uniforms,
    get patched() {
      return patched;
    },
  };
}
