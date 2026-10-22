import { useEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { Coordinates } from "../../data/places";
import { useReducedMotion } from "../../hooks/useReducedMotion";
import { createGlowTexture } from "./glowTexture";

const ARC_SEGMENTS = 96;
const ARC_WIDTH_PIXELS = 2.4;
const ARC_REVEAL_SECONDS = 1.6;
const PULSE_PERIOD_SECONDS = 4.5;
// Lifts markers and route ends just off the map so they never flicker into it.
const SURFACE_OFFSET = 1.006;
// Numerical guard: a route this short cannot be interpolated along a great circle.
const MIN_JOURNEY_RADIANS = 0.001;
// Keeps the journey slightly above the centre of the frame.
const VIEW_TILT_RADIANS = 0.12;
// Seen slightly from the side, the route's height above the globe stays readable.
const VIEW_YAW_OFFSET_RADIANS = 0.22;
const MAX_PIXEL_RATIO = 2;

const colors = {
  ocean: 0x0b2744,
  atmosphere: 0x8fc0e6,
  origin: 0xf0b06a,
  destination: 0xb7e0c0,
  arc: 0xf3c98f,
};

const atmosphereShader = {
  vertexShader: `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3 glowColor;
    varying vec3 vNormal;
    void main() {
      float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
      gl_FragColor = vec4(glowColor, 1.0) * intensity;
    }
  `,
};

function toPosition({ latitude, longitude }: Coordinates, radius = 1) {
  const polar = THREE.MathUtils.degToRad(90 - latitude);
  const azimuth = THREE.MathUtils.degToRad(longitude + 180);
  return new THREE.Vector3(
    -radius * Math.sin(polar) * Math.cos(azimuth),
    radius * Math.cos(polar),
    radius * Math.sin(polar) * Math.sin(azimuth),
  );
}

function slerp(start: THREE.Vector3, end: THREE.Vector3, angle: number, progress: number) {
  const sine = Math.sin(angle);
  return start.clone().multiplyScalar(Math.sin((1 - progress) * angle) / sine)
    .add(end.clone().multiplyScalar(Math.sin(progress * angle) / sine));
}

// Great-circle route lifted above the surface, higher for longer journeys.
function journeyPoints(start: THREE.Vector3, end: THREE.Vector3, angle: number) {
  const altitude = 0.08 + 0.32 * (angle / Math.PI);
  return Array.from({ length: ARC_SEGMENTS + 1 }, (_, index) => {
    const progress = index / ARC_SEGMENTS;
    return slerp(start, end, angle, progress).multiplyScalar(SURFACE_OFFSET + altitude * Math.sin(Math.PI * progress));
  });
}

type TrajectoryGlobeProps = {
  origin: Coordinates;
  destination?: Coordinates;
  caption: ReactNode;
};

/** Earth globe tracing a member's path from the school; the caption carries the information. */
export function TrajectoryGlobe({ origin, destination, caption }: TrajectoryGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reducedMotion = useReducedMotion();
  const { latitude: originLatitude, longitude: originLongitude } = origin;
  const destinationLatitude = destination?.latitude;
  const destinationLongitude = destination?.longitude;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    } catch {
      canvas.dataset.unsupported = "true";
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const originPoint: Coordinates = { latitude: originLatitude, longitude: originLongitude };
    const destinationPoint: Coordinates | undefined = destinationLatitude !== undefined && destinationLongitude !== undefined
      ? { latitude: destinationLatitude, longitude: destinationLongitude }
      : undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    camera.position.set(0, 0, 4.6);
    const world = new THREE.Group();
    scene.add(world);
    // Light stays in camera space: the lit side does not move as the globe sways.
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const sunlight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    sunlight.position.set(-3, 2.4, 4);
    scene.add(sunlight);

    const disposables: Array<{ dispose: () => void }> = [];
    const track = <T extends { dispose: () => void }>(resource: T) => {
      disposables.push(resource);
      return resource;
    };

    const earthMaterial = track(new THREE.MeshStandardMaterial({ color: colors.ocean, roughness: 1, metalness: 0 }));
    world.add(new THREE.Mesh(track(new THREE.SphereGeometry(1, 96, 64)), earthMaterial));
    const atmosphere = new THREE.Mesh(
      track(new THREE.SphereGeometry(1.13, 64, 48)),
      track(new THREE.ShaderMaterial({
        ...atmosphereShader,
        uniforms: { glowColor: { value: new THREE.Color(colors.atmosphere) } },
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      })),
    );
    scene.add(atmosphere);

    const glowTexture = track(createGlowTexture());
    const nodeGeometry = track(new THREE.SphereGeometry(0.026, 16, 16));
    const addNode = (position: THREE.Vector3, color: number, glowScale: number) => {
      const node = new THREE.Mesh(nodeGeometry, track(new THREE.MeshBasicMaterial({ color })));
      node.position.copy(position);
      world.add(node);
      const glow = new THREE.Sprite(track(new THREE.SpriteMaterial({
        map: glowTexture, color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
      glow.position.copy(position);
      glow.scale.setScalar(glowScale);
      world.add(glow);
      return glow;
    };

    const start = toPosition(originPoint).normalize();
    const originGlow = addNode(start.clone().multiplyScalar(SURFACE_OFFSET), colors.origin, 0.3);
    const haloMaterial = track(new THREE.MeshBasicMaterial({ color: colors.origin, transparent: true, opacity: 0.6, side: THREE.DoubleSide }));
    const halo = new THREE.Mesh(track(new THREE.RingGeometry(0.05, 0.06, 48)), haloMaterial);
    halo.position.copy(start.clone().multiplyScalar(SURFACE_OFFSET));
    halo.lookAt(start.clone().multiplyScalar(2));
    world.add(halo);

    const buildJourney = (end: THREE.Vector3, angle: number) => {
      const points = journeyPoints(start, end, angle);
      const geometry = track(new LineGeometry());
      geometry.setPositions(points.flatMap((point) => [point.x, point.y, point.z]));
      const material = track(new LineMaterial({ color: colors.arc, linewidth: ARC_WIDTH_PIXELS, transparent: true, opacity: 0.95 }));
      const line = new Line2(geometry, material);
      world.add(line);
      const destinationGlow = addNode(end.clone().multiplyScalar(SURFACE_OFFSET), colors.destination, 0.28);
      const pulse = new THREE.Sprite(track(new THREE.SpriteMaterial({
        map: glowTexture, color: colors.arc, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
      pulse.scale.setScalar(0.15);
      pulse.visible = false;
      world.add(pulse);
      return { end, geometry, material, line, destinationGlow, pulse, curve: new THREE.CatmullRomCurve3(points) };
    };

    const end = destinationPoint ? toPosition(destinationPoint).normalize() : undefined;
    const journeyAngle = end ? start.angleTo(end) : 0;
    const journey = end && journeyAngle > MIN_JOURNEY_RADIANS ? buildJourney(end, journeyAngle) : undefined;

    // Face the middle of the journey (or the school) with north kept up.
    const focus = journey ? start.clone().add(journey.end).normalize() : start.clone();
    const baseYaw = Math.atan2(-focus.x, focus.z) + (journey ? VIEW_YAW_OFFSET_RADIANS : 0);
    const horizontal = Math.hypot(focus.x, focus.z);
    world.rotation.set(Math.atan2(focus.y, horizontal) - VIEW_TILT_RADIANS, baseYaw, 0);

    const resize = () => {
      const cssWidth = Math.max(canvas.clientWidth, 1);
      const cssHeight = Math.max(canvas.clientHeight, 1);
      const pixelRatio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
      const width = Math.floor(cssWidth * pixelRatio);
      const height = Math.floor(cssHeight * pixelRatio);
      renderer.setSize(width, height, false);
      camera.aspect = cssWidth / cssHeight;
      camera.updateProjectionMatrix();
      if (journey) {
        journey.material.resolution.set(width, height);
        journey.material.linewidth = ARC_WIDTH_PIXELS * pixelRatio;
      }
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    let frame = 0;
    let visible = true;
    let disposed = false;
    const startedAt = performance.now();

    const render = (time = startedAt) => {
      const elapsed = Math.max(0, (time - startedAt) / 1000);
      const reveal = reducedMotion ? 1 : Math.min(1, elapsed / ARC_REVEAL_SECONDS);
      if (!reducedMotion) {
        world.rotation.y = baseYaw + Math.sin(elapsed * 0.22) * 0.1;
        const breathing = 1 + Math.sin(elapsed * 2.6) * 0.18;
        halo.scale.setScalar(breathing);
        haloMaterial.opacity = 0.42 + Math.sin(elapsed * 2.6) * 0.2;
        originGlow.scale.setScalar(0.3 * (0.92 + Math.sin(elapsed * 1.9) * 0.1));
      }
      if (journey) {
        journey.line.visible = reveal > 0;
        journey.geometry.instanceCount = Math.max(1, Math.floor(reveal * ARC_SEGMENTS));
        journey.destinationGlow.visible = reveal >= 1;
        journey.pulse.visible = !reducedMotion && reveal >= 1;
        if (journey.pulse.visible) {
          const progress = ((elapsed - ARC_REVEAL_SECONDS) / PULSE_PERIOD_SECONDS) % 1;
          journey.pulse.position.copy(journey.curve.getPointAt(progress));
        }
      }
      renderer.render(scene, camera);
      if (!reducedMotion && visible && document.visibilityState === "visible") {
        frame = window.requestAnimationFrame(render);
      }
    };

    // The globe shows its ocean at once; the map code and data load only with a globe.
    import("./worldTexture")
      .then(({ createWorldTexture }) => createWorldTexture(originPoint, journey ? destinationPoint : undefined))
      .then((texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        track(texture);
        texture.anisotropy = Math.min(texture.anisotropy, renderer.capabilities.getMaxAnisotropy());
        earthMaterial.map = texture;
        earthMaterial.color.set(0xffffff);
        earthMaterial.needsUpdate = true;
        if (reducedMotion) render();
      })
      .catch(() => undefined);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      const nextVisible = Boolean(entry?.isIntersecting);
      if (nextVisible === visible) return;
      visible = nextVisible;
      window.cancelAnimationFrame(frame);
      if (visible) frame = window.requestAnimationFrame(render);
    });
    visibilityObserver.observe(canvas);
    render();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      disposables.forEach((resource) => resource.dispose());
      renderer.dispose();
    };
    // Coordinates are compared by value so a re-render with the same place keeps the scene.
  }, [originLatitude, originLongitude, destinationLatitude, destinationLongitude, reducedMotion]);

  return (
    <figure className="trajectory-globe">
      <canvas ref={canvasRef} className="trajectory-globe__canvas" aria-hidden="true" />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
