/**
 * Patched physically-based skin material for the BodyViewer scan assets.
 *
 * The high-detail GLBs bake categorical region ids plus three realism
 * channels: _AO (crease occlusion), _CURV (signed curvature), and _TINT
 * (hair / brow / beard / lip pigment).  This material keeps the single-mesh,
 * single-draw-call interaction contract, but shades it more like layered skin:
 * warm RGB wrap lighting, thin-feature transmission, cavity colour shifts,
 * procedural pore-scale bump/roughness, and local pigment zones.
 *
 * The patch is guarded: if a future three.js shader chunk changes, it falls
 * back to plain MeshPhysicalMaterial rather than risking a black canvas.
 */
import {
  Color,
  MeshPhysicalMaterial,
  ShaderChunk,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';

export type SkinQuality = 'high' | 'low';

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
  uPoreStrength: { value: number };
  uCavityStrength: { value: number };
  uDetailStrength: { value: number };
};

export type SkinMaterialHandle = {
  material: MeshPhysicalMaterial;
  uniforms: SkinUniforms;
  /** true after the SSS/highlight patch compiled in; false = plain PBR fallback */
  patched: boolean;
};

const ACCENT = '#00d4a8';

export function createSkinMaterial(
  accent: string = ACCENT,
  quality: SkinQuality = 'high',
): SkinMaterialHandle {
  const uniforms: SkinUniforms = {
    uActiveRegion: { value: -1 },
    uHoverRegion: { value: -1 },
    uHoverStrength: { value: 0.3 },
    uTime: { value: 0 },
    uHighlightColor: { value: new Color(accent) },
    uDimOthers: { value: 0 },
    uWrap: { value: 0.48 },
    uSSSColor: { value: new Color('#c94a37') },
    uSSSIntensity: { value: 0.48 },
    uRimColor: { value: new Color('#ffe6d2') },
    uRimStrength: { value: 0.11 },
    uKeyLightDirView: { value: new Vector3(0.5, 0.5, 0.7) },
    uPoreStrength: { value: quality === 'high' ? 0.105 : 0.055 },
    uCavityStrength: { value: quality === 'high' ? 0.82 : 0.55 },
    uDetailStrength: { value: quality === 'high' ? 1.0 : 0.55 },
  };

  const material = new MeshPhysicalMaterial({
    color: new Color('#b9826c'),
    roughness: 0.58,
    metalness: 0.0,
    // Skin F0 is ~2.8%, corresponding to IOR ~1.4.  The default 4% reads
    // waxy/plastic on untextured scans.
    ior: 1.4,
    specularIntensity: 0.48,
    specularColor: new Color('#fff2e7'),
    clearcoat: 0.045,
    clearcoatRoughness: 0.82,
    sheen: 0.18,
    sheenColor: new Color('#ffd7bd'),
    sheenRoughness: 0.72,
  });

  // Default values let replacement GLBs omit optional channels without
  // breaking WebGL attribute binding. _REGIONID = -1 simply disables picking
  // highlight on that mesh; _THICKNESS = torso-like thickness disables glow.
  (material as MeshPhysicalMaterial & { defaultAttributeValues?: Record<string, number[]> }).defaultAttributeValues = {
    _regionid: [-1],
    _thickness: [0.18],
    _ao: [0],
    _curv: [0],
    _tint: [0],
  };

  const handle: SkinMaterialHandle = { material, uniforms, patched: false };

  const VERT_COMMON = '#include <common>';
  const VERT_BEGIN = '#include <begin_vertex>';
  const FRAG_COMMON = '#include <common>';
  const FRAG_DIFFUSE = 'vec4 diffuseColor = vec4( diffuse, opacity );';
  const FRAG_NORMAL = '#include <normal_fragment_maps>';
  const FRAG_ROUGH = '#include <roughnessmap_fragment>';
  const FRAG_OUT = 'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;';
  const LIGHTS_INCLUDE = '#include <lights_physical_pars_fragment>';
  const DIRECT_IRRADIANCE =
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\tvec3 irradiance = dotNL * directLight.color;';

  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    try {
      const lightsChunk = ShaderChunk.lights_physical_pars_fragment as string;
      const ok =
        shader.vertexShader.includes(VERT_COMMON) &&
        shader.vertexShader.includes(VERT_BEGIN) &&
        shader.fragmentShader.includes(FRAG_COMMON) &&
        shader.fragmentShader.includes(FRAG_DIFFUSE) &&
        shader.fragmentShader.includes(FRAG_NORMAL) &&
        shader.fragmentShader.includes(FRAG_ROUGH) &&
        shader.fragmentShader.includes(FRAG_OUT) &&
        shader.fragmentShader.includes(LIGHTS_INCLUDE) &&
        lightsChunk.includes(DIRECT_IRRADIANCE);
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
          attribute float _tint;
          uniform float uActiveRegion;
          uniform float uHoverRegion;
          varying float vBvReg;
          varying float vBvSel;
          varying float vBvHov;
          varying float vBvThick;
          varying float vBvAO;
          varying float vBvCurv;
          varying float vBvTint;
          varying vec3 vBvObjPos;`,
        )
        .replace(
          VERT_BEGIN,
          /* glsl */ `${VERT_BEGIN}
          vBvReg = floor( _regionid + 0.5 );
          vBvSel = ( abs( vBvReg - uActiveRegion ) < 0.5 ) ? 1.0 : 0.0;
          vBvHov = ( abs( vBvReg - uHoverRegion ) < 0.5 ) ? 1.0 : 0.0;
          vBvThick = _thickness;
          vBvAO = clamp( _ao, 0.0, 1.0 );
          vBvCurv = clamp( _curv, -1.0, 1.0 );
          vBvTint = clamp( _tint, -1.0, 1.0 );
          vBvObjPos = transformed;`,
        );

      // RGB wrap lighting: red wraps farther into the terminator than green,
      // blue least of all.  That warm falloff is a major difference between
      // skin and neutral clay/plastic.
      const wrappedLights = lightsChunk.replace(
        DIRECT_IRRADIANCE,
        /* glsl */ `float bvRawNL = dot( geometryNormal, directLight.direction );
	float dotNL = saturate( ( bvRawNL + uWrap ) / ( 1.0 + uWrap ) );
	vec3 bvWrapNL = vec3(
	  saturate( ( bvRawNL + uWrap * 1.34 ) / ( 1.0 + uWrap * 1.34 ) ),
	  dotNL,
	  saturate( ( bvRawNL + uWrap * 0.72 ) / ( 1.0 + uWrap * 0.72 ) )
	);
	vec3 irradiance = bvWrapNL * directLight.color;`,
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
          uniform float uPoreStrength;
          uniform float uCavityStrength;
          uniform float uDetailStrength;
          varying float vBvReg;
          varying float vBvSel;
          varying float vBvHov;
          varying float vBvThick;
          varying float vBvAO;
          varying float vBvCurv;
          varying float vBvTint;
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
          }
          float bvFbm( vec3 p ) {
            return bvNoise( p ) * 0.50 + bvNoise( p * 2.17 + 19.1 ) * 0.31 + bvNoise( p * 4.03 + 71.7 ) * 0.19;
          }
          float bvEqReg( float id ) {
            return 1.0 - step( 0.5, abs( vBvReg - id ) );
          }
          float bvAnyReg4( float a, float b, float c, float d ) {
            return min( 1.0, bvEqReg( a ) + bvEqReg( b ) + bvEqReg( c ) + bvEqReg( d ) );
          }
          float bvAnyReg6( float a, float b, float c, float d, float e, float f ) {
            return min( 1.0, bvAnyReg4( a, b, c, d ) + bvEqReg( e ) + bvEqReg( f ) );
          }
          vec3 bvPerturbNormal( vec3 n, vec3 pos, float height, float strength ) {
            vec3 dpdx = dFdx( pos );
            vec3 dpdy = dFdy( pos );
            float dhdx = dFdx( height );
            float dhdy = dFdy( height );
            vec3 r1 = cross( dpdy, n );
            vec3 r2 = cross( n, dpdx );
            float det = dot( dpdx, r1 );
            return normalize( abs( det ) * n - sign( det ) * ( dhdx * r1 + dhdy * r2 ) * strength );
          }`,
        )
        .replace(LIGHTS_INCLUDE, wrappedLights)
        .replace(
          FRAG_DIFFUSE,
          /* glsl */ `${FRAG_DIFFUSE}
          {
            float bvThin = 1.0 - smoothstep( 0.006, 0.064, vBvThick );
            float bvFace = bvEqReg( 5.0 ) + bvEqReg( 2.0 ) + bvEqReg( 3.0 ) + bvEqReg( 4.0 );
            float bvHands = bvAnyReg6( 31.0, 32.0, 33.0, 34.0, 35.0, 36.0 ) + bvEqReg( 37.0 ) + bvEqReg( 38.0 );
            float bvFeet = bvAnyReg6( 74.0, 75.0, 76.0, 77.0, 78.0, 79.0 ) + bvEqReg( 80.0 ) + bvEqReg( 81.0 );
            float bvJoints = bvAnyReg6( 25.0, 26.0, 60.0, 61.0, 62.0, 63.0 ) + bvAnyReg4( 64.0, 65.0, 66.0, 67.0 );
            float bvExtremities = clamp( bvHands + bvFeet, 0.0, 1.0 );

            float bvMacro = bvFbm( vBvObjPos * 23.0 + vec3( 0.0, 4.7, 2.1 ) );
            float bvMottle = bvFbm( vBvObjPos * 72.0 + vec3( 8.0, 0.0, 3.0 ) );
            float bvPores = bvFbm( vBvObjPos * 245.0 + vec3( 31.0, 9.0, 0.0 ) );
            float bvFreckle = smoothstep( 0.80, 0.965, bvFbm( vBvObjPos * 118.0 + vec3( 3.0, 17.0, 43.0 ) ) )
              * clamp( bvFace + bvEqReg( 1.0 ), 0.0, 1.0 );

            // Region zoning: face/hands/feet are slightly warmer and more
            // vascular; knees/elbows drier and a touch red; covered torso
            // stays calmer.  These are subtle multipliers, not face paint.
            vec3 bvSkin = diffuseColor.rgb;
            bvSkin *= mix( vec3( 1.0 ), vec3( 1.075, 0.955, 0.925 ), clamp( bvThin * 0.70 + bvExtremities * 0.18, 0.0, 1.0 ) );
            bvSkin = mix( bvSkin, bvSkin * vec3( 1.065, 0.965, 0.925 ), clamp( bvFace * 0.28 + bvHands * 0.16, 0.0, 0.42 ) );
            bvSkin = mix( bvSkin, bvSkin * vec3( 1.09, 0.91, 0.86 ), clamp( bvJoints * 0.14, 0.0, 0.20 ) );
            bvSkin *= 0.955 + 0.075 * bvMacro + 0.040 * bvMottle;
            bvSkin *= 1.0 - 0.075 * bvFreckle;

            // Baked pigment channel: positive = keratin / melanin features
            // (short hair cap, eyebrows, lashes, beard shadow), negative =
            // vermilion / rosy tissue (lips, tiny joint/nipple tint).
            float bvHair = smoothstep( 0.05, 0.78, vBvTint );
            float bvLip = smoothstep( 0.05, 0.90, -vBvTint );
            bvSkin = mix( bvSkin, vec3( 0.125, 0.082, 0.055 ), bvHair * 0.72 );
            bvSkin = mix( bvSkin, vec3( 0.58, 0.255, 0.225 ), bvLip * 0.72 );

            // Baked AO and curvature are colour-corrected: cavities go warmer
            // and darker, never sooty black.
            float bvCavity = smoothstep( 0.05, 0.55, vBvCurv ) * uCavityStrength;
            float bvOcc = clamp( vBvAO * 0.95 + bvCavity * 0.17, 0.0, 0.78 );
            bvSkin = mix( bvSkin, bvSkin * vec3( 0.74, 0.58, 0.50 ), bvOcc );

            // Pores mostly influence local colour at grazing / highlight scale;
            // the normal perturbation below carries the tactile part.
            bvSkin *= 0.988 + ( bvPores - 0.5 ) * 0.036 * uDetailStrength;
            diffuseColor.rgb = max( bvSkin, vec3( 0.0 ) );
          }`,
        )
        .replace(
          FRAG_NORMAL,
          /* glsl */ `${FRAG_NORMAL}
          {
            float bvPoreH =
              bvFbm( vBvObjPos * 310.0 + vec3( 5.0, 19.0, 41.0 ) ) * 0.62 +
              bvFbm( vBvObjPos * 92.0 + vec3( 13.0, 1.0, 7.0 ) ) * 0.38;
            float bvCavityMask = 1.0 - clamp( vBvAO * 1.25 + smoothstep( 0.08, 0.55, vBvCurv ) * 0.7, 0.0, 0.82 );
            float bvHair = smoothstep( 0.05, 0.78, vBvTint );
            normal = bvPerturbNormal( normalize( normal ), vBvObjPos, bvPoreH, uPoreStrength * bvCavityMask * ( 1.0 - bvHair * 0.65 ) );
          }`,
        )
        .replace(
          FRAG_ROUGH,
          /* glsl */ `${FRAG_ROUGH}
          {
            float bvPore = bvFbm( vBvObjPos * 230.0 + vec3( 11.0, 37.0, 2.0 ) );
            float bvThinR = 1.0 - smoothstep( 0.008, 0.062, vBvThick );
            float bvHair = smoothstep( 0.05, 0.78, vBvTint );
            float bvLip = smoothstep( 0.05, 0.90, -vBvTint );
            float bvDryJoints = bvAnyReg6( 25.0, 26.0, 60.0, 61.0, 62.0, 63.0 ) + bvAnyReg4( 64.0, 65.0, 76.0, 77.0 );
            roughnessFactor = roughnessFactor * ( 0.95 + 0.12 * bvPore );
            roughnessFactor += clamp( bvDryJoints, 0.0, 1.0 ) * 0.075;
            roughnessFactor += bvHair * 0.18;
            roughnessFactor -= bvLip * 0.13;
            roughnessFactor -= bvThinR * 0.055;
            roughnessFactor = clamp( roughnessFactor, 0.40, 0.78 );
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
            float bvThin = 1.0 - smoothstep( 0.009, 0.060, vBvThick );
            float bvHair = smoothstep( 0.05, 0.78, vBvTint );
            float bvLip = smoothstep( 0.05, 0.90, -vBvTint );

            // Approximated subsurface backscatter. Thin areas glow warm when
            // backlit, lips get a tiny vascular lift, hair receives none.
            float bvBack = pow( saturate( dot( bvV, -normalize( bvL + bvN * 0.35 ) ) ), 1.6 );
            vec3 bvSSS = uSSSColor * uSSSIntensity * ( bvBack * 0.72 + 0.22 )
              * ( bvThin * ( 1.0 - bvHair ) + bvLip * 0.25 )
              * saturate( totalDiffuse.g * 1.55 );
            outgoingLight += min( bvSSS, vec3( 0.30 ) );

            // Tight secondary sheen lobe: a soft oily highlight without
            // pushing the whole skin toward plastic.
            vec3 bvH = normalize( bvL + bvV );
            float bvSheen = pow( saturate( dot( bvN, bvH ) ), 72.0 )
              * ( 1.0 - smoothstep( 0.22, 0.75, vBvAO ) )
              * ( 1.0 - bvHair * 0.80 );
            outgoingLight += vec3( 1.0, 0.84, 0.70 ) * bvSheen * 0.050;

            outgoingLight += uRimColor * bvFres * uRimStrength * ( 1.0 - bvHair * 0.70 );
            outgoingLight = min( outgoingLight, vec3( 1.0 ) );

            // Sharpen interpolated region membership so highlighting follows
            // anatomical label borders rather than bleeding across them.
            float bvSelS = smoothstep( 0.38, 0.62, vBvSel );
            float bvHovS = smoothstep( 0.38, 0.62, vBvHov );
            float bvGrey = dot( outgoingLight, vec3( 0.299, 0.587, 0.114 ) );
            vec3 bvDimmed = mix( outgoingLight, vec3( bvGrey ), 0.35 ) * 0.55;
            outgoingLight = mix( outgoingLight, bvDimmed, uDimOthers * ( 1.0 - bvSelS ) );

            float bvPulse = 0.25 + 0.25 * ( 0.5 + 0.5 * sin( uTime * 5.2359878 ) );
            float bvGlow = bvSelS * bvPulse + bvHovS * ( 1.0 - bvSelS ) * uHoverStrength * 0.55;
            outgoingLight = mix( outgoingLight, uHighlightColor * ( 0.55 + bvGrey * 0.8 ), bvGlow * 1.35 );
            outgoingLight += uHighlightColor * bvGlow * bvFres * 0.9;
          }`,
        );
      handle.patched = true;
    } catch (err) {
      console.warn('[BodyViewer] skin shader patch failed — plain PBR fallback', err);
    }
  };
  material.customProgramCacheKey = () => `bodyviewer-skin-v2-${quality}`;

  return handle;
}
