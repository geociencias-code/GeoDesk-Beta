declare module 'react-globe.gl' {
  import React from 'react';
  import { Camera, Scene, WebGLRenderer } from 'three';

  export interface GlobeMethods {
    pointOfView: (view: { lat?: number; lng?: number; altitude?: number }, duration?: number) => void;
    controls: () => {
      autoRotate: boolean;
      autoRotateSpeed: number;
      enableZoom: boolean;
      enablePan: boolean;
      [key: string]: any;
    };
    scene: () => Scene;
    camera: () => Camera;
    renderer: () => WebGLRenderer;
    [key: string]: any;
  }

  export interface GlobeProps {
    ref?: React.RefObject<GlobeMethods>;
    globeImageUrl?: string;
    bumpImageUrl?: string;
    backgroundImageUrl?: string;
    showAtmosphere?: boolean;
    atmosphereColor?: string;
    atmosphereAltitude?: number;
    [key: string]: any;
  }

  const Globe: React.ForwardRefExoticComponent<GlobeProps & React.RefAttributes<GlobeMethods>>;
  export default Globe;
}

