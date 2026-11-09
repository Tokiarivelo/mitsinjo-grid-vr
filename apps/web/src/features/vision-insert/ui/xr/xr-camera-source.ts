'use client';

import * as THREE from 'three';

/**
 * Camera Facing modes aligned with Meta IWSDK Chapter 13.
 */
export type CameraFacing = 'unknown' | 'front' | 'back';

/**
 * Camera Lifecycle States aligned with Meta IWSDK Chapter 13.
 */
export type CameraState = 'inactive' | 'starting' | 'active' | 'error';

export interface CameraDeviceInfo {
  deviceId: string;
  label: string;
  facing: CameraFacing;
}

export interface CameraSourceConfig {
  deviceId?: string;
  facing?: CameraFacing;
  width?: number;
  height?: number;
  frameRate?: number;
}

/**
 * Meta IWSDK-aligned Camera Utilities (CameraUtils).
 * Provides device enumeration, permission check, and frame capture.
 */
export const CameraUtils = {
  /**
   * Enumerate video-input devices.
   */
  async getDevices(): Promise<CameraDeviceInfo[]> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d) => {
          let facing: CameraFacing = 'unknown';
          const label = (d.label || '').toLowerCase();
          if (label.includes('back') || label.includes('rear') || label.includes('environment')) {
            facing = 'back';
          } else if (label.includes('front') || label.includes('user') || label.includes('face')) {
            facing = 'front';
          }
          return {
            deviceId: d.deviceId,
            label: d.label || `Camera ${d.deviceId.slice(0, 5)}`,
            facing,
          };
        });
    } catch {
      return [];
    }
  },

  /**
   * Check camera permission without initiating a stream.
   */
  async hasPermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.permissions?.query) {
      return false;
    }
    try {
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      return status.state === 'granted';
    } catch {
      return false;
    }
  },

  /**
   * Capture a high-res frame snapshot from an active HTMLVideoElement.
   */
  captureFrame(video: HTMLVideoElement | null): string | null {
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return null;
    }
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.88);
  },
};

/**
 * IWSDK-style Camera Source Controller (Chapter 13: Camera Access).
 * Manages video element, media stream, Three.js VideoTexture, and lifecycle.
 */
export class XRCameraSource {
  public state: CameraState = 'inactive';
  public videoElement: HTMLVideoElement | null = null;
  public stream: MediaStream | null = null;
  public texture: THREE.VideoTexture | null = null;
  public error: string | null = null;
  public activeFacing: CameraFacing = 'unknown';
  public hasRealFrames = false;

  private config: CameraSourceConfig;
  private onStateChange?: (state: CameraState) => void;
  private lastFrameTime = -1;

  constructor(config: CameraSourceConfig = {}, onStateChange?: (state: CameraState) => void) {
    this.config = {
      facing: 'unknown',
      width: 1280,
      height: 720,
      frameRate: 30,
      ...config,
    };
    this.onStateChange = onStateChange;
  }

  private setState(newState: CameraState) {
    this.state = newState;
    this.onStateChange?.(newState);
  }

  /**
   * Start camera stream aligned with IWSDK constraints logic:
   * When facing is 'unknown' and deviceId is empty, selects the first available camera.
   */
  public async start(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.setState('error');
      this.error = 'MediaDevices API unavailable';
      return false;
    }

    this.setState('starting');
    this.error = null;
    this.hasRealFrames = false;
    this.lastFrameTime = -1;

    try {
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: this.config.width || 1280 },
        height: { ideal: this.config.height || 720 },
        frameRate: { ideal: this.config.frameRate || 30 },
      };

      if (this.config.deviceId) {
        videoConstraints.deviceId = { exact: this.config.deviceId };
      } else if (this.config.facing === 'back') {
        videoConstraints.facingMode = { ideal: 'environment' };
      } else if (this.config.facing === 'front') {
        videoConstraints.facingMode = { ideal: 'user' };
      }
      // Note: when facing is 'unknown' and deviceId is empty, no facingMode is passed,
      // which allows the browser to select ANY available camera (desktop webcam, phone, Quest).

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (err) {
        // Fallback: permissive video input without strict constraints
        console.warn('[XRCameraSource] Initial constraint failed, trying fallback:', err);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      this.stream = stream;

      // Inspect active track
      const track = stream.getVideoTracks()[0];
      if (track) {
        const settings = track.getSettings?.();
        if (settings?.facingMode === 'environment') this.activeFacing = 'back';
        else if (settings?.facingMode === 'user') this.activeFacing = 'front';
      }

      // Create video element and attach to DOM inside visible viewport so Chrome compositor
      // executes requestVideoFrameCallback and hardware video decoding without throttling.
      // Opacity is set to 0.85 (above Chromium's 0.05 power-saver occlusion threshold)
      // so the browser video pipeline continues decoding frames smoothly during WebXR.
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.setAttribute('data-testid', 'xr-camera-preview-video');
      video.style.cssText =
        'position:fixed;bottom:12px;right:12px;width:160px;height:90px;opacity:0.85;pointer-events:none;z-index:9999;border-radius:8px;border:1px solid rgba(56,189,248,0.4);box-shadow:0 4px 16px rgba(0,0,0,0.5);object-fit:cover;overflow:hidden;';
      document.body.appendChild(video);

      this.videoElement = video;

      // Track live frame delivery via timeupdate
      video.addEventListener('timeupdate', () => {
        if (video.currentTime > 0) {
          this.hasRealFrames = true;
        }
      });

      // Wait for stream to deliver first frame
      await new Promise<void>((resolve) => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
          resolve();
        } else {
          const onCanPlay = () => {
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('loadeddata', onCanPlay);
            resolve();
          };
          video.addEventListener('canplay', onCanPlay, { once: true });
          video.addEventListener('loadeddata', onCanPlay, { once: true });
          video.play().catch(() => resolve());
          setTimeout(resolve, 2000);
        }
      });

      await video.play().catch(() => {});

      // We intentionally do NOT create an automatic continuous THREE.VideoTexture here.
      // Continuous 60-90fps VideoTexture uploads (texSubImage2D of 1280x720 video frames)
      // floods the GPU command buffer (220-330 MB/s) causing driver watchdog resets
      // and WebGL context loss on Linux Optimus dual-GPU setups.
      // Frame snapshots are captured on-demand via CameraUtils.captureFrame(videoElement).
      this.texture = null;
      this.setState('active');
      return true;
    } catch (err) {
      console.error('[XRCameraSource] Failed to start camera:', err);
      this.error = err instanceof Error ? err.message : String(err);
      this.setState('error');
      return false;
    }
  }

  /**
   * Request an update to the underlying texture if new frame data is available.
   * Throttles to hardware video frame changes to prevent GPU PCIe/command buffer saturation.
   */
  public updateTexture(): boolean {
    if (!this.texture || !this.videoElement) return false;
    if (this.videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
    const curTime = this.videoElement.currentTime;
    if (curTime > 0 && curTime !== this.lastFrameTime) {
      this.lastFrameTime = curTime;
      this.hasRealFrames = true;
      this.texture.needsUpdate = true;
      return true;
    }
    return false;
  }

  /**
   * Stop camera stream and cleanup DOM and WebGL resources.
   */
  public stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.srcObject = null;
      if (this.videoElement.parentNode) {
        this.videoElement.parentNode.removeChild(this.videoElement);
      }
      this.videoElement = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.hasRealFrames = false;
    this.lastFrameTime = -1;
    this.setState('inactive');
  }
}
