/* Minimal low-poly WebGL engine: matrices, a mesh builder, and a flat-shaded
 * forward renderer. No dependencies — the game ships as plain files, so a
 * library from a CDN is not an option.
 *
 * Flat shading comes from the face normal recovered in the fragment shader with
 * screen-space derivatives, which works even for geometry displaced on the GPU
 * (the water). Devices without OES_standard_derivatives fall back to the baked
 * per-vertex normals every mesh already carries.
 */
window.Engine = (() => {
  'use strict';

  // ------------------------------------------------------------------ colour
  function hex(h) {
    const n = parseInt(h.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  // ----------------------------------------------------------------- matrices
  const m4 = {
    create: () => new Float32Array(16),
    identity(o) {
      o.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
      return o;
    },
    perspective(o, fovy, aspect, near, far) {
      const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
      o.set([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
      return o;
    },
    lookAt(o, eye, at, up) {
      let z0 = eye[0] - at[0], z1 = eye[1] - at[1], z2 = eye[2] - at[2];
      let l = Math.hypot(z0, z1, z2) || 1;
      z0 /= l; z1 /= l; z2 /= l;
      let x0 = up[1] * z2 - up[2] * z1, x1 = up[2] * z0 - up[0] * z2, x2 = up[0] * z1 - up[1] * z0;
      l = Math.hypot(x0, x1, x2) || 1;
      x0 /= l; x1 /= l; x2 /= l;
      const y0 = z1 * x2 - z2 * x1, y1 = z2 * x0 - z0 * x2, y2 = z0 * x1 - z1 * x0;
      o.set([
        x0, y0, z0, 0,
        x1, y1, z1, 0,
        x2, y2, z2, 0,
        -(x0 * eye[0] + x1 * eye[1] + x2 * eye[2]),
        -(y0 * eye[0] + y1 * eye[1] + y2 * eye[2]),
        -(z0 * eye[0] + z1 * eye[1] + z2 * eye[2]), 1,
      ]);
      return o;
    },
    mul(o, a, b) {
      for (let c = 0; c < 4; c++) {
        for (let r = 0; r < 4; r++) {
          o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                         a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
        }
      }
      return o;
    },
    // translation * rotY * uniform scale — every model matrix the game needs
    trs(o, tx, ty, tz, ry, sx, sy, sz) {
      const c = Math.cos(ry), s = Math.sin(ry);
      o.set([
        c * sx, 0, -s * sx, 0,
        0, sy, 0, 0,
        s * sz, 0, c * sz, 0,
        tx, ty, tz, 1,
      ]);
      return o;
    },
  };

  // Deterministic RNG so a scenery chunk always rebuilds identically.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ------------------------------------------------------------ mesh building
  class Builder {
    constructor() { this.v = []; this.n = 0; }
    // a, b, c: [x,y,z]. wave = 1 marks a vertex the water shader displaces.
    tri(a, b, c, col, wave) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      const w = wave || 0;
      for (const p of [a, b, c]) {
        this.v.push(p[0], p[1], p[2], nx, ny, nz, col[0], col[1], col[2], w);
        this.n++;
      }
    }
    quad(a, b, c, d, col, wave) { this.tri(a, b, c, col, wave); this.tri(a, c, d, col, wave); }
    get count() { return this.n; }
  }

  // ------------------------------------------------------------------ shaders
  const VERT = (deriv) => `
  attribute vec3 aPos;
  attribute vec3 aNrm;
  attribute vec3 aCol;
  attribute float aWave;
  uniform mat4 uVP, uModel;
  uniform float uTime;
  varying vec3 vCol, vWorld, vNrm;

  // Visual swell only — the physics plane stays flat at y = 0, so the
  // amplitude has to stay small enough that the stone never looks wrong.
  float waveH(float x, float z) {
    return sin(x * 0.17 + uTime * 1.15) * 0.20
         + sin(z * 0.23 - uTime * 1.45) * 0.16
         + sin((x + z) * 0.09 + uTime * 0.70) * 0.26;
  }

  void main() {
    vec3 w = (uModel * vec4(aPos, 1.0)).xyz;
    vec3 n = aNrm;
    if (aWave > 0.5) {
      w.y += waveH(w.x, w.z);
${deriv ? '' : `
      // analytic gradient, only needed when derivatives are unavailable
      float e = 0.6;
      float hx = waveH(w.x + e, w.z) - waveH(w.x - e, w.z);
      float hz = waveH(w.x, w.z + e) - waveH(w.x, w.z - e);
      n = normalize(vec3(-hx, 2.0 * e, -hz));`}
    }
    vWorld = w;
    vNrm = n;
    vCol = aCol;
    gl_Position = uVP * vec4(w, 1.0);
  }`;

  const FRAG = (deriv) => `
  ${deriv ? '#extension GL_OES_standard_derivatives : enable' : ''}
  precision highp float;
  varying vec3 vCol, vWorld, vNrm;
  uniform vec3 uLight, uCam, uFog;
  uniform float uFogNear, uFogFar, uAlpha, uSpec;

  void main() {
    vec3 view = normalize(uCam - vWorld);
    ${deriv
      ? 'vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));\n    if (dot(n, view) < 0.0) n = -n;'
      : 'vec3 n = normalize(vNrm);\n    if (dot(n, view) < 0.0) n = -n;'}
    vec3 L = normalize(uLight);
    float lam = max(dot(n, L), 0.0);
    float sky = 0.5 + 0.5 * n.y;                 // cheap hemisphere ambient
    // A weak view-aligned fill keeps surfaces turned away from the sun legible.
    // Without it the stone's leading face goes nearly black from the chase cam.
    float fill = max(dot(n, view), 0.0);
    vec3 c = vCol * (0.32 + 0.28 * sky + 0.55 * lam + 0.20 * fill);
    if (uSpec > 0.0) {
      float s = pow(max(dot(reflect(-L, n), view), 0.0), 24.0);
      c += vec3(1.0, 0.97, 0.86) * s * uSpec;
    }
    float f = clamp((length(vWorld - uCam) - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(c, uFog, f), uAlpha);
  }`;

  // Sky is a full-screen gradient with the sun painted straight into it.
  const SKY_V = `
  attribute vec2 aP;
  varying vec2 vUv;
  void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

  const SKY_F = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uTop, uMid, uBot;
  uniform vec2 uSun;
  uniform vec3 uSunCol;
  uniform float uAspect;
  void main() {
    float t = vUv.y;
    vec3 c = t > 0.5 ? mix(uMid, uTop, (t - 0.5) * 2.0) : mix(uBot, uMid, t * 2.0);
    vec2 d = (vUv - uSun) * vec2(uAspect, 1.0);
    float r = length(d);
    c += uSunCol * (smoothstep(0.30, 0.0, r) * 0.55 + smoothstep(0.045, 0.028, r) * 0.9);
    gl_FragColor = vec4(c, 1.0);
  }`;

  // ----------------------------------------------------------------- renderer
  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  function program(gl, vs, fs, attrs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('link: ' + gl.getProgramInfoLog(p));
    }
    p.u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
    return p;
  }

  function create(canvas) {
    const opts = { antialias: true, alpha: false, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) return null;

    const deriv = !!gl.getExtension('OES_standard_derivatives');
    const main = program(gl, VERT(deriv), FRAG(deriv), ['aPos', 'aNrm', 'aCol', 'aWave']);
    const sky = program(gl, SKY_V, SKY_F, ['aP']);

    const skyBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    const VP = m4.create(), PROJ = m4.create(), VIEW = m4.create(), MODEL = m4.create();

    const api = {
      gl, deriv,

      mesh(builder) {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(builder.v), gl.STATIC_DRAW);
        return { buf, count: builder.count };
      },

      resize(w, h, dpr) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        gl.viewport(0, 0, canvas.width, canvas.height);
        api.aspect = canvas.width / canvas.height;
      },

      // sky first, with depth writes off so it never occludes the scene
      drawSky(top, mid, bot, sunUv, sunCol) {
        gl.depthMask(false);
        gl.disable(gl.DEPTH_TEST);
        gl.useProgram(sky);
        for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
        gl.bindBuffer(gl.ARRAY_BUFFER, skyBuf);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.uniform3fv(sky.u.uTop, top);
        gl.uniform3fv(sky.u.uMid, mid);
        gl.uniform3fv(sky.u.uBot, bot);
        gl.uniform2fv(sky.u.uSun, sunUv);
        gl.uniform3fv(sky.u.uSunCol, sunCol);
        gl.uniform1f(sky.u.uAspect, api.aspect);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
      },

      fogRange(near, far) {
        gl.uniform1f(main.u.uFogNear, near);
        gl.uniform1f(main.u.uFogFar, far);
      },

      begin(eye, at, fov, near, far, opt) {
        m4.perspective(PROJ, fov, api.aspect, near, far);
        m4.lookAt(VIEW, eye, at, [0, 1, 0]);
        m4.mul(VP, PROJ, VIEW);
        gl.useProgram(main);
        for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
        gl.uniformMatrix4fv(main.u.uVP, false, VP);
        gl.uniform3fv(main.u.uCam, eye);
        gl.uniform3fv(main.u.uLight, opt.light);
        gl.uniform3fv(main.u.uFog, opt.fog);
        gl.uniform1f(main.u.uFogNear, opt.fogNear);
        gl.uniform1f(main.u.uFogFar, opt.fogFar);
        gl.uniform1f(main.u.uTime, opt.time);
        gl.uniform1f(main.u.uAlpha, 1);
        gl.uniform1f(main.u.uSpec, 0);
      },

      draw(mesh, tx, ty, tz, ry, sx, sy, sz, alpha, spec) {
        m4.trs(MODEL, tx, ty, tz, ry || 0,
               sx === undefined ? 1 : sx,
               sy === undefined ? (sx === undefined ? 1 : sx) : sy,
               sz === undefined ? (sx === undefined ? 1 : sx) : sz);
        gl.uniformMatrix4fv(main.u.uModel, false, MODEL);
        gl.uniform1f(main.u.uAlpha, alpha === undefined ? 1 : alpha);
        gl.uniform1f(main.u.uSpec, spec || 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buf);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 40, 24);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 40, 36);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      },

      blend(on) {
        if (on) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
        } else {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
        }
      },

      cull(on) { if (on) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE); },

      clear(c) {
        gl.clearColor(c[0], c[1], c[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      },
    };
    return api;
  }

  return { create, Builder, m4, hex, mixc, rng };
})();
