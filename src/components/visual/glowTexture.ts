import * as THREE from "three";

/** Soft radial sprite shared by the trajectory scenes for nodes and pulses. */
export function createGlowTexture() {
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
