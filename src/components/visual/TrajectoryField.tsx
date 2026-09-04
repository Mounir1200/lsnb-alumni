import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "../../hooks/useReducedMotion";

const routeDefinitions = [
  { endpoint: [-2.7, 1.45, -0.4], color: 0xd99452, glow: 0xf0c38a, speed: 0.115, phase: 0.12 },
  { endpoint: [-1.3, -1.85, 0.2], color: 0x77a982, glow: 0xa8d1b1, speed: 0.092, phase: 0.48 },
  { endpoint: [2.75, 1.15, -0.1], color: 0xd99452, glow: 0xf0c38a, speed: 0.104, phase: 0.72 },
  { endpoint: [2.1, -1.65, 0.35], color: 0x77a982, glow: 0xa8d1b1, speed: 0.084, phase: 0.3 },
  { endpoint: [0.25, 2.15, -0.55], color: 0xd99452, glow: 0xf0c38a, speed: 0.097, phase: 0.88 },
] as const;

function seededRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function createGlowTexture() {
  const source = document.createElement("canvas");
  source.width = 64;
  source.height = 64;
  const context = source.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.18, "rgba(255,255,255,.86)");
    gradient.addColorStop(0.5, "rgba(255,255,255,.22)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
  }
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function TrajectoryField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: "low-power",
      });
    } catch {
      canvas.dataset.unsupported = "true";
      return;
    }

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 9.5);

    const world = new THREE.Group();
    world.rotation.set(-0.08, -0.15, 0.04);
    scene.add(world);

    const orbitGroup = new THREE.Group();
    world.add(orbitGroup);

    const pointCount = 420;
    const positions = new Float32Array(pointCount * 3);
    for (let index = 0; index < pointCount; index += 1) {
      const angle = seededRandom(index + 1) * Math.PI * 2;
      const radius = 0.65 + seededRandom(index + 77) * 3.5;
      positions[index * 3] = Math.cos(angle) * radius;
      positions[index * 3 + 1] = Math.sin(angle) * radius * 0.68;
      positions[index * 3 + 2] = (seededRandom(index + 151) - 0.5) * 2.4;
    }

    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const dustMaterial = new THREE.PointsMaterial({
      color: 0xa9c8b0,
      size: 0.025,
      transparent: true,
      opacity: 0.48,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    world.add(dust);

    const orbitGeometries: THREE.BufferGeometry[] = [];
    const orbitMaterials: THREE.LineBasicMaterial[] = [];
    [
      { x: 2.2, y: 1.34, z: -0.45, color: 0x7094ad, opacity: 0.18, rotation: [0.18, 0.15, 0.12] },
      { x: 3.15, y: 2, z: -0.8, color: 0xd99452, opacity: 0.13, rotation: [-0.22, 0.3, -0.18] },
      { x: 3.8, y: 2.45, z: -1.05, color: 0x77a982, opacity: 0.1, rotation: [0.35, -0.18, 0.22] },
    ].forEach((orbit) => {
      const points = new THREE.EllipseCurve(0, 0, orbit.x, orbit.y, 0, Math.PI * 2)
        .getPoints(160)
        .map((point) => new THREE.Vector3(point.x, point.y, orbit.z));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: orbit.color,
        transparent: true,
        opacity: orbit.opacity,
      });
      const line = new THREE.LineLoop(geometry, material);
      line.rotation.set(orbit.rotation[0]!, orbit.rotation[1]!, orbit.rotation[2]!);
      orbitGeometries.push(geometry);
      orbitMaterials.push(material);
      orbitGroup.add(line);
    });

    const glowTexture = createGlowTexture();
    const centralGeometry = new THREE.SphereGeometry(0.105, 20, 20);
    const centralMaterial = new THREE.MeshBasicMaterial({ color: 0xe2a15f });
    const centralNode = new THREE.Mesh(centralGeometry, centralMaterial);
    world.add(centralNode);

    const centralGlowMaterial = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xe2a15f,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const centralGlow = new THREE.Sprite(centralGlowMaterial);
    centralGlow.scale.setScalar(1.15);
    world.add(centralGlow);

    const haloGeometry = new THREE.RingGeometry(0.18, 0.205, 64);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: 0xe2a15f,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    world.add(halo);

    const scanGeometry = new THREE.RingGeometry(2.88, 2.895, 160, 1, 0, Math.PI * 0.62);
    const scanMaterial = new THREE.MeshBasicMaterial({
      color: 0xe2a15f,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const scanner = new THREE.Mesh(scanGeometry, scanMaterial);
    scanner.position.z = -0.15;
    world.add(scanner);

    const routeMaterials: THREE.LineBasicMaterial[] = [];
    const routeGeometries: THREE.BufferGeometry[] = [];
    const endpointGeometry = new THREE.SphereGeometry(0.06, 16, 16);
    const endpointMaterials: THREE.MeshBasicMaterial[] = [];
    const glowMaterials: THREE.SpriteMaterial[] = [];
    const routeVisuals: Array<{
      curve: THREE.QuadraticBezierCurve3;
      geometry: THREE.BufferGeometry;
      endpoint: THREE.Mesh;
      endpointGlow: THREE.Sprite;
      pulses: THREE.Sprite[];
      speed: number;
      phase: number;
      delay: number;
    }> = [];

    routeDefinitions.forEach((definition, index) => {
      const endpoint = new THREE.Vector3(...definition.endpoint);
      const midpoint = endpoint.clone().multiplyScalar(0.52);
      midpoint.z = 1.05 + index * 0.13;
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(), midpoint, endpoint);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(96));
      geometry.setDrawRange(0, reducedMotion ? 97 : 0);
      const material = new THREE.LineBasicMaterial({
        color: definition.color,
        transparent: true,
        opacity: index === 2 ? 0.92 : 0.62,
      });
      world.add(new THREE.Line(geometry, material));
      routeGeometries.push(geometry);
      routeMaterials.push(material);

      const endpointMaterial = new THREE.MeshBasicMaterial({ color: definition.glow });
      const endpointNode = new THREE.Mesh(endpointGeometry, endpointMaterial);
      endpointNode.position.copy(endpoint);
      endpointNode.scale.setScalar(index === 2 ? 1.35 : 1);
      world.add(endpointNode);
      endpointMaterials.push(endpointMaterial);

      const endpointGlowMaterial = new THREE.SpriteMaterial({
        map: glowTexture,
        color: definition.glow,
        transparent: true,
        opacity: 0.58,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const endpointGlow = new THREE.Sprite(endpointGlowMaterial);
      endpointGlow.position.copy(endpoint);
      endpointGlow.scale.setScalar(index === 2 ? 0.62 : 0.45);
      world.add(endpointGlow);
      glowMaterials.push(endpointGlowMaterial);

      const pulses = [0, 1].map((pulseIndex) => {
        const pulseMaterial = new THREE.SpriteMaterial({
          map: glowTexture,
          color: definition.glow,
          transparent: true,
          opacity: pulseIndex === 0 ? 0.9 : 0.56,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
        const pulse = new THREE.Sprite(pulseMaterial);
        pulse.scale.setScalar(pulseIndex === 0 ? 0.3 : 0.2);
        pulse.visible = reducedMotion;
        world.add(pulse);
        glowMaterials.push(pulseMaterial);
        return pulse;
      });

      routeVisuals.push({
        curve,
        geometry,
        endpoint: endpointNode,
        endpointGlow,
        pulses,
        speed: definition.speed,
        phase: definition.phase,
        delay: 0.28 + index * 0.15,
      });
    });

    const resize = () => {
      const cssWidth = Math.max(canvas.clientWidth, 1);
      const cssHeight = Math.max(canvas.clientHeight, 1);
      const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
      let width = Math.floor(cssWidth * pixelRatio);
      let height = Math.floor(cssHeight * pixelRatio);
      const maximumPixels = 1920 * 1080;
      const scale = width * height > maximumPixels
        ? Math.sqrt(maximumPixels / (width * height))
        : 1;
      width = Math.floor(width * scale);
      height = Math.floor(height * scale);

      renderer.setSize(width, height, false);
      camera.aspect = cssWidth / cssHeight;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    let frame = 0;
    let visible = true;
    let pointerX = 0;
    let pointerY = 0;
    const startedAt = performance.now();

    const onPointerMove = (event: PointerEvent) => {
      const bounds = canvas.getBoundingClientRect();
      pointerX = (event.clientX - bounds.left) / bounds.width - 0.5;
      pointerY = (event.clientY - bounds.top) / bounds.height - 0.5;
    };
    const onPointerLeave = () => {
      pointerX = 0;
      pointerY = 0;
    };

    const render = (time = startedAt) => {
      const elapsed = Math.max(0, (time - startedAt) / 1000);

      if (!reducedMotion) {
        world.rotation.y += (pointerX * 0.2 - world.rotation.y) * 0.025;
        world.rotation.x += (-0.08 - pointerY * 0.12 - world.rotation.x) * 0.02;
        world.position.x += (pointerX * 0.12 - world.position.x) * 0.02;
        world.position.y += (-pointerY * 0.08 - world.position.y) * 0.02;
        dust.rotation.z = elapsed * 0.007;
        orbitGroup.rotation.z = elapsed * 0.018;
        orbitGroup.rotation.y = Math.sin(elapsed * 0.18) * 0.08;
        scanner.rotation.z = -elapsed * 0.23;

        const originPulse = 1 + Math.sin(elapsed * 3.1) * 0.13;
        halo.scale.setScalar(originPulse);
        haloMaterial.opacity = 0.46 + Math.sin(elapsed * 3.1) * 0.18;
        centralGlow.scale.setScalar(1.05 + Math.sin(elapsed * 2.15) * 0.22);
        centralGlowMaterial.opacity = 0.56 + Math.sin(elapsed * 2.15) * 0.13;

        routeVisuals.forEach((route, routeIndex) => {
          const reveal = Math.min(1, Math.max(0, (elapsed - route.delay) / 1.3));
          route.geometry.setDrawRange(0, Math.max(1, Math.floor(reveal * 97)));
          route.endpoint.visible = reveal > 0.82;
          route.endpointGlow.visible = reveal > 0.82;

          route.pulses.forEach((pulse, pulseIndex) => {
            pulse.visible = reveal > 0.68;
            const progress = (elapsed * route.speed + route.phase + pulseIndex * 0.5) % 1;
            pulse.position.copy(route.curve.getPointAt(progress));
            const baseScale = pulseIndex === 0 ? 0.29 : 0.2;
            pulse.scale.setScalar(baseScale * (0.84 + Math.sin(elapsed * 4 + routeIndex) * 0.16));
          });

          const endpointPulse = 0.92 + Math.sin(elapsed * 2.2 + routeIndex * 0.8) * 0.16;
          route.endpointGlow.scale.setScalar((routeIndex === 2 ? 0.62 : 0.45) * endpointPulse);
        });
      }

      renderer.render(scene, camera);
      if (!reducedMotion && visible && document.visibilityState === "visible") {
        frame = window.requestAnimationFrame(render);
      }
    };

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      const nextVisible = Boolean(entry?.isIntersecting);
      if (nextVisible === visible) return;
      visible = nextVisible;
      window.cancelAnimationFrame(frame);
      if (visible) frame = window.requestAnimationFrame(render);
    });
    visibilityObserver.observe(canvas);

    if (!reducedMotion) {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
    }
    render();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      dustGeometry.dispose();
      dustMaterial.dispose();
      orbitGeometries.forEach((geometry) => geometry.dispose());
      orbitMaterials.forEach((material) => material.dispose());
      centralGeometry.dispose();
      centralMaterial.dispose();
      centralGlowMaterial.dispose();
      haloGeometry.dispose();
      haloMaterial.dispose();
      scanGeometry.dispose();
      scanMaterial.dispose();
      routeGeometries.forEach((geometry) => geometry.dispose());
      routeMaterials.forEach((material) => material.dispose());
      endpointGeometry.dispose();
      endpointMaterials.forEach((material) => material.dispose());
      glowMaterials.forEach((material) => material.dispose());
      glowTexture.dispose();
      renderer.dispose();
    };
  }, [reducedMotion]);

  return (
    <div className="trajectory-field" aria-hidden="true">
      <canvas ref={canvasRef} className="trajectory-field__canvas" />
      <span className="trajectory-field__label trajectory-field__label--origin">
        Bobo-Dioulasso <b>Origine</b>
      </span>
      <span className="trajectory-field__label trajectory-field__label--north">Montréal</span>
      <span className="trajectory-field__label trajectory-field__label--east">Kigali</span>
      <span className="trajectory-field__label trajectory-field__label--south">Abidjan</span>
    </div>
  );
}
