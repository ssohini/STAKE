'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export interface CoinAnimationState {
  /** Y-axis rotation in radians */
  rotY: number;
  /** X-axis pitch tilt in radians */
  rotX: number;
  /** Z-axis subtle roll in radians */
  rotZ: number;
}

interface DollarCoin3DProps {
  /** Shared mutable animation state updated at 60fps by parent choreography */
  animRef: React.MutableRefObject<CoinAnimationState>;
  /** CSS size of the square canvas container */
  className?: string;
}

/**
 * Generates procedural 1024x1024 albedo, bump, and roughness textures for a
 * realistic minted US Golden Dollar coin using offscreen HTML5 Canvas.
 */
function createCoinFaceTextures(): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
} {
  const size = 1024;
  const cx = size / 2;
  const cy = size / 2;

  // 1. Albedo (rich minted US Golden Dollar manganese-brass contrast so highlights never blow out)
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cctx = colorCanvas.getContext('2d')!;

  const baseGrad = cctx.createRadialGradient(
    cx - 110,
    cy - 130,
    30,
    cx,
    cy,
    size * 0.5
  );
  baseGrad.addColorStop(0, '#dfb860');
  baseGrad.addColorStop(0.5, '#b6842c');
  baseGrad.addColorStop(0.85, '#8f6318');
  baseGrad.addColorStop(1, '#cfa144');
  cctx.fillStyle = baseGrad;
  cctx.fillRect(0, 0, size, size);

  // Subtle concentric lathe-brushed metallic rings
  for (let r = 60; r < 492; r += 3) {
    cctx.beginPath();
    cctx.arc(cx, cy, r, 0, Math.PI * 2);
    cctx.strokeStyle =
      r % 6 === 0 ? 'rgba(255, 232, 168, 0.06)' : 'rgba(40, 24, 4, 0.08)';
    cctx.lineWidth = 1.5;
    cctx.stroke();
  }

  // Deeper satin recessed inner field for strong 3D relief contrast
  cctx.beginPath();
  cctx.arc(cx, cy, 428, 0, Math.PI * 2);
  cctx.fillStyle = 'rgba(56, 36, 6, 0.16)';
  cctx.fill();

  // Polished raised outer rim collar + inner step
  cctx.beginPath();
  cctx.arc(cx, cy, 472, 0, Math.PI * 2);
  cctx.strokeStyle = '#e7c26c';
  cctx.lineWidth = 42;
  cctx.stroke();

  cctx.beginPath();
  cctx.arc(cx, cy, 434, 0, Math.PI * 2);
  cctx.strokeStyle = 'rgba(48, 30, 4, 0.45)';
  cctx.lineWidth = 6;
  cctx.stroke();

  cctx.beginPath();
  cctx.arc(cx, cy, 368, 0, Math.PI * 2);
  cctx.strokeStyle = 'rgba(244, 212, 130, 0.55)';
  cctx.lineWidth = 5;
  cctx.stroke();

  // Crisp embossed '$' shadow + burnished raised gold face
  cctx.font = '800 430px Georgia, "Times New Roman", serif';
  cctx.textAlign = 'center';
  cctx.textBaseline = 'middle';

  cctx.fillStyle = 'rgba(48, 28, 4, 0.6)';
  cctx.fillText('$', cx + 7, cy + 29);

  cctx.fillStyle = '#f3d484';
  cctx.fillText('$', cx, cy + 20);

  cctx.strokeStyle = 'rgba(85, 54, 10, 0.45)';
  cctx.lineWidth = 5;
  cctx.strokeText('$', cx, cy + 20);

  // 2. Bump Map (controls 3D micro-relief light catching)
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d')!;

  bctx.fillStyle = '#606060';
  bctx.fillRect(0, 0, size, size);

  // Fine radial brushed micro-grooves
  for (let r = 20; r < 430; r += 2) {
    bctx.beginPath();
    bctx.arc(cx, cy, r, 0, Math.PI * 2);
    bctx.strokeStyle = r % 4 === 0 ? '#6b6b6b' : '#565656';
    bctx.lineWidth = 1;
    bctx.stroke();
  }

  // Outer raised milled collar
  bctx.beginPath();
  bctx.arc(cx, cy, 472, 0, Math.PI * 2);
  bctx.strokeStyle = '#f2f2f2';
  bctx.lineWidth = 44;
  bctx.stroke();

  // Inner raised ring
  bctx.beginPath();
  bctx.arc(cx, cy, 368, 0, Math.PI * 2);
  bctx.strokeStyle = '#d4d4d4';
  bctx.lineWidth = 6;
  bctx.stroke();

  // Security denticles (120 tiny ticks inside rim)
  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * Math.PI * 2;
    const x1 = cx + Math.cos(angle) * 418;
    const y1 = cy + Math.sin(angle) * 418;
    const x2 = cx + Math.cos(angle) * 436;
    const y2 = cy + Math.sin(angle) * 436;
    bctx.beginPath();
    bctx.moveTo(x1, y1);
    bctx.lineTo(x2, y2);
    bctx.strokeStyle = '#c8c8c8';
    bctx.lineWidth = 3.5;
    bctx.stroke();
  }

  // Embossed perimeter curved lettering (top & bottom arcs)
  drawArcText(bctx, 'UNITED STATES OF AMERICA', cx, cy, 394, -Math.PI / 2, false, '#dcdcdc');
  drawArcText(bctx, 'ONE DOLLAR', cx, cy, 394, Math.PI / 2, true, '#dcdcdc');

  // Markers at 3 & 9 o'clock
  for (const angle of [0, Math.PI]) {
    const sx = cx + Math.cos(angle) * 394;
    const sy = cy + Math.sin(angle) * 394;
    bctx.beginPath();
    bctx.arc(sx, sy, 8, 0, Math.PI * 2);
    bctx.fillStyle = '#e0e0e0';
    bctx.fill();
  }

  // Crisp raised '$' face in bump map
  bctx.fillStyle = '#fafafa';
  bctx.font = '800 430px Georgia, "Times New Roman", serif';
  bctx.textAlign = 'center';
  bctx.textBaseline = 'middle';
  bctx.fillText('$', cx, cy + 20);

  // 3. Roughness Map (polished raised elements = darker/shinier; satin field = lighter)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rctx = roughCanvas.getContext('2d')!;

  rctx.fillStyle = '#626262'; // satin brushed field (~0.38 roughness)
  rctx.fillRect(0, 0, size, size);

  for (let r = 40; r < 430; r += 3) {
    rctx.beginPath();
    rctx.arc(cx, cy, r, 0, Math.PI * 2);
    rctx.strokeStyle = r % 6 === 0 ? '#555555' : '#6c6c6c';
    rctx.lineWidth = 1.5;
    rctx.stroke();
  }

  // Mirror-polished raised rim & '$' (~0.16 roughness)
  rctx.beginPath();
  rctx.arc(cx, cy, 466, 0, Math.PI * 2);
  rctx.strokeStyle = '#282828';
  rctx.lineWidth = 42;
  rctx.stroke();

  rctx.fillStyle = '#242424';
  rctx.font = '800 440px Georgia, "Times New Roman", serif';
  rctx.textAlign = 'center';
  rctx.textBaseline = 'middle';
  rctx.fillText('$', cx, cy + 20);

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 8;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.anisotropy = 8;

  return { map, bumpMap, roughnessMap };
}

function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  centerAngle: number,
  reverse: boolean,
  fillStyle: string
) {
  ctx.save();
  ctx.font = '700 28px Arial, Helvetica, sans-serif';
  ctx.fillStyle = fillStyle;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const step = 0.088;
  const totalSpan = (text.length - 1) * step;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const offset = i * step - totalSpan / 2;
    const angle = reverse ? centerAngle - offset : centerAngle + offset;

    ctx.save();
    ctx.translate(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.rotate(reverse ? angle - Math.PI / 2 : angle + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Generates vertical reeded/milled grooves for the cylindrical outer coin rim.
 */
function createReededEdgeBump(): THREE.CanvasTexture {
  const width = 2048;
  const height = 64;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, width, height);

  const teeth = 160;
  const toothW = width / teeth;
  for (let i = 0; i < teeth; i++) {
    const x = i * toothW;
    const g = ctx.createLinearGradient(x, 0, x + toothW, 0);
    g.addColorStop(0, '#303030');
    g.addColorStop(0.5, '#f0f0f0');
    g.addColorStop(1, '#303030');
    ctx.fillStyle = g;
    ctx.fillRect(x, 0, toothW, height);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

export function DollarCoin3D({ animRef, className = '' }: DollarCoin3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      host.innerHTML =
        '<div style="width:100%;height:100%;border-radius:9999px;border:3px solid #e9c874;background:radial-gradient(circle at 35% 30%,#f6dfa2,#c7993c 60%,#7c5a18);display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-weight:900;color:#473108;">$</div>';
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';

    host.innerHTML = '';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    scene.environmentIntensity = 0.95;

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    camera.position.set(0, 0, 3.88);

    // Raking studio key light, cool rim highlight, and warm under-fill
    const keyLight = new THREE.DirectionalLight('#fff5db', 1.85);
    keyLight.position.set(-3.4, 3.8, 2.4);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#e0e7ff', 2.0);
    rimLight.position.set(3.4, 1.4, -2.5);
    scene.add(rimLight);

    const warmFill = new THREE.DirectionalLight('#c48c2c', 0.85);
    warmFill.position.set(0, -3.0, 2.2);
    scene.add(warmFill);

    const { map, bumpMap, roughnessMap } = createCoinFaceTextures();
    const edgeBump = createReededEdgeBump();

    // Rotate CylinderGeometry so circular caps face +Z / -Z toward camera
    const geometry = new THREE.CylinderGeometry(1, 1, 0.16, 128, 1, false);
    geometry.rotateX(Math.PI / 2);

    const faceMaterial = new THREE.MeshStandardMaterial({
      map,
      bumpMap,
      bumpScale: 0.085,
      roughnessMap,
      roughness: 0.92,
      metalness: 0.94,
      envMapIntensity: 1.05,
    });

    const edgeMaterial = new THREE.MeshStandardMaterial({
      color: '#cfa045',
      bumpMap: edgeBump,
      bumpScale: 0.045,
      metalness: 0.96,
      roughness: 0.25,
      envMapIntensity: 1.15,
    });

    // CylinderGeometry material groups: 0 = side wall, 1 = top cap (+Z), 2 = bottom cap (-Z)
    const coinMesh = new THREE.Mesh(geometry, [
      edgeMaterial,
      faceMaterial,
      faceMaterial,
    ]);
    // Rotate -90 deg around Z so '$' sits vertically upright after rotateX(PI/2)
    coinMesh.rotation.z = -Math.PI / 2;

    const pivot = new THREE.Group();
    pivot.add(coinMesh);
    scene.add(pivot);

    function syncSize() {
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const side = Math.max(64, Math.round(Math.min(rect.width, rect.height)));
      renderer.setSize(side, side, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
    }

    syncSize();
    const resizeObserver = new ResizeObserver(syncSize);
    resizeObserver.observe(host);

    let rafId = 0;
    const renderLoop = () => {
      const state = animRef.current;
      pivot.rotation.y = state.rotY;
      pivot.rotation.x = state.rotX;
      pivot.rotation.z = state.rotZ;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(renderLoop);
    };
    rafId = requestAnimationFrame(renderLoop);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      geometry.dispose();
      faceMaterial.dispose();
      edgeMaterial.dispose();
      map.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
      edgeBump.dispose();
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
    };
  }, [animRef]);

  return <div ref={hostRef} className={`h-full w-full ${className}`} />;
}
