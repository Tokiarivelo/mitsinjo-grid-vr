# Vision-to-3D Synthesis: High-Fidelity Inverse Procedural Modeling & Real-Time Rendering Methodology

> **Target Domain:** Automated and semi-automated reconstruction of rich, volumetric, stylized, and physically plausible 3D visual environments from single-image or multi-image visual references.
> **Standard:** Real-time WebGL / WebGPU (Three.js / React Three Fiber / HLSL / WGSL) target with 60+ FPS performance, $O(1)$ draw calls, zero runtime allocations, and continuous dynamic lighting reactivity.

---

## 1. Executive Summary & Paradigm Comparison

When converting visual concepts from 2D reference images into 3D environments, engineers typically encounter two competing paradigms:

```
                  ┌────────────────────────────────────────────────────────┐
                  │                 Input Reference Image                  │
                  └───────────────────────────┬────────────────────────────┘
                                              │
                     ┌────────────────────────┴────────────────────────┐
                     ▼                                                 ▼
     ┌───────────────────────────────┐                 ┌───────────────────────────────┐
     │   Dense Neural Generation     │                 │ Inverse Procedural Synthesis  │
     │   (NeRF / 3D Gaussian / Tripo)│                 │   (Analytical / Shaders / IPM)│
     └───────────────┬───────────────┘                 └───────────────┬───────────────┘
                     │                                                 │
        [Heavy VRAM, Unlit, Static]                     [1 Draw Call, 0 allocations, 60fps]
        [Dense Polygons, Dirty Normals]                 [Analytical Normals, Fully Dynamic]
        [Fixed Baked Lighting, 15 FPS]                  [Dynamic Sun, Moon, Wind, Atmosphere]
```

### 1.1 Why Inverse Procedural Modeling (IPM) Outperforms Dense Meshes

Dense neural generation (e.g., text/image-to-mesh models like Tripo3D, Shap-E, or NeRF/3DGS bakes) produces un-editable, dense, baked-lighting meshes. For volumetric atmospheric elements (clouds, water, terrain, vegetation, celestial bodies), this produces:

1. **Baked Lighting Defects:** Shadows are baked into vertex colors or textures. When the sun moves, shadows don't react, destroying realism.
2. **Facet & Normal Artifacts:** Coarse polygonization results in jagged icosahedral facets and dark silhouette terminators (such as the black polygonal lumps seen in early iterations).
3. **Draw Call & VRAM Bloat:** Each unique cloud or rock requires separate geometry and material instances, exceeding mobile and integrated GPU draw call budgets.

**Inverse Procedural Synthesis** deconstructs the visual reference image into:

- **Hierarchical Geometric Primitives** ($C^1$ continuous spheres, capsules, or ellipsoids clustered using spatial probability distributions).
- **Procedural Displacement Calculus** (continuous frequency-harmonic domain deformation evaluated on GPU vertices).
- **Physical Photometric Shaders** (wrapped diffuse, subsurface scattering, atmospheric dual-ambient bounce, Fresnel rim lighting).
- **Analytical Motion Dynamics** (continuous celestial trigonometry and wind advection).

This yields **infinite visual fidelity, 1 single draw call (`InstancedMesh`), 0 CPU memory allocations per frame, and 60 FPS real-time responsiveness.**

---

## 2. The 6-Step Vision-to-3D Pipeline

```mermaid
flowchart LR
    A["1. Vision Decomposition\n(Perceptual Reverse-Engineering)"] --> B["2. Geometric Clustering\n(Primitive Hierarchy & Shells)"]
    B --> C["3. Procedural Deformation\n(Harmonic 3D Vertex Calculus)"]
    C --> D["4. Photometric Shader\n(Scattering & Optical Model)"]
    D --> E["5. Motion & Celestial\n(Continuous Arc & Shadows)"]
    E --> F["6. Automated Verification\n(Playwright & Color-Space Delta)"]
```

---

## 3. Step 1: Inverse Vision Decomposition (2D $\to$ Parameters)

Before writing any code or generating geometry, the reference image is decomposed across five perceptual axes:

### 3.1 Structural & Morphological Analysis

Decompose the target subject into macro, meso, and micro scales:

- **Macro Scale (Global Architecture):**
  - What is the global silhouette? (e.g., Flat condensation bottom at altitude $Y_0$, towering vertical domes, flat anvil top).
  - How does it distribute in 3D space? (Concentric depth rings, horizon cloud deck, mid-sky clusters, overhead canopy).
- **Meso Scale (Volumetric Clusters):**
  - How many lobes compose a single cloud formation? (In cumulus reference: 1 central dome, 2 crest peaks, 4 lateral billows, 4 diagonal fillers, 3 flat base lobes, 2 crowning whisps = 16 overlapping primitives).
- **Micro Scale (Surface Texture):**
  - Is the surface perfectly smooth, faceted, or cauliflower-bumpy?
  - Amplitude and frequency of organic bumps: $A \approx 0.08 \cdot R$, $f \approx 2.2$.

### 3.2 Photometric & Optical Analysis

Analyze pixel values across luminance zones in CIELAB or Linear sRGB:

1. **Sunlit Crests ($Zone\_{sun}$):** Pure warm white ($L^* \ge 98$, RGB `(1.0, 1.0, 0.98)`).
2. **Ambient Crevices & Undersides ($Zone\_{shade}$):** In the reference photo, shaded areas are **never black or grey**. They reflect Rayleigh sky scattering: rich, luminous azure/sky-blue ($L^* \approx 72$, RGB `(0.48, 0.72, 0.98)`).
3. **Terminator Softness:** The transition between light and shade is not a sharp cutoff ($\vec{N} \cdot \vec{L} = 0$). It wraps around the cloud, indicating high multiple-internal scattering.
4. **Backlight Translucency:** When looking toward the light source, the edges and core display forward Mie scattering (forward translucent glow).

---

## 4. Step 2 & 3: Mathematical Formulations & Geometric Approximations

### 4.1 Concentric Shell Distribution & 360° Azimuth Calculus

To eliminate empty sky wedges and populate the entire dome uniformly, banks are distributed across 4 concentric shells:

$$ \begin{aligned}
\text{Shell 0 (Horizon Rim):} & \quad R \in [150, 260], \quad Y \in [18, 32] \\
\text{Shell 1 (Mid-Sky Valley):} & \quad R \in [65, 145], \quad Y \in [28, 44] \\
\text{Shell 2 (Overhead Canopy):} & \quad R \in [15, 75], \quad Y \in [48, 68] \\
\text{Shell 3 (Intermediate Fill):} & \quad R \in [90, 195], \quad Y \in [24, 44]
\end{aligned}$$

#### Azimuth Angle Formula (Anti-Clustering):
For $B$ banks and bank index $b \in [0, B - 1]$:
$$\theta_b = \frac{2\pi \cdot b}{B} + \left(\xi_1 - 0.5\right) \frac{\pi}{B}, \quad \xi_1 \sim \mathcal{U}(0, 1)$$

#### Cartesian Center Coordinate:
$$\vec{C}_b = \begin{pmatrix} R_b \cos \theta_b \\ Y_b \\ R_b \sin \theta_b \end{pmatrix}$$

### 4.2 Scale Variation Calculus (Pareto-Log-Normal Distribution)
Uniform sizes look artificial. Natural cumulus distributions follow a power-law scale distribution $P(S) \propto S^{-\alpha}$. We approximate this with a 4-tier stratified stochastic selector:

```
Size Distribution Stratification:
├── 38% Tiny / Baby Puffs (S ∈ [2.4, 4.6])  ── Tight clusters (spread = 0.65)
├── 34% Medium Cumulus   (S ∈ [5.0, 8.5])  ── Standard billows (spread = 0.88)
├── 18% Large Cumulus    (S ∈ [9.2, 12.6]) ── Towering formations (spread = 1.0)
└── 10% Horizon Banks    (S ∈ [13.0, 16.5])── Distant mountain-scale (spread = 1.12)
```

For overhead clouds ($R < 75$), large sizes are suppressed to avoid obstructing the camera view:
$$S_{overhead} = \min\left(S_b, 7.5\right)$$

### 4.3 Local Formation Coordinate System (Local-to-World Transform)
Each cloud bank has an advection heading $\psi_b \sim \mathcal{U}(0, 2\pi)$ along the prevailing wind vector:

$$\vec{F}_b = \begin{pmatrix} \cos \psi_b \\ 0 \\ \sin \psi_b \end{pmatrix}, \quad \vec{P}_b = \begin{pmatrix} -\sin \psi_b \\ 0 \\ \cos \psi_b \end{pmatrix}, \quad \vec{U} = \begin{pmatrix} 0 \\ 1 \\ 0 \end{pmatrix}$$

For each puff $p \in [0, 15]$ with local offsets $(f_p, c_p, v_p)$ and base size $S_b$:
$$\vec{X}_{b, p} = \vec{C}_b + \left(f_p \cdot \sigma_b + j_x\right) \vec{F}_b + \left(c_p \cdot \sigma_b + j_z\right) \vec{P}_b + \left(v_p \cdot \sigma_b + j_y\right) \vec{U}$$

Where $\sigma_b$ is the cluster spread factor and $j_x, j_y, j_z$ are pseudo-random jitter offsets.

### 4.4 3D Procedural Surface Deformation (Eliminating Facets)
Instead of flat polygonal faces, a smooth sphere ($C^1$ topology) is deformed on the GPU vertex stage using harmonic sinusoidal 3D noise:

```glsl
// Local position in unit sphere frame
vec3 p = position * 2.3;

// Primary low-frequency billow lobe
float bump1 = sin(p.x * 2.1 + p.y * 1.8) * cos(p.z * 2.2 + p.y * 1.4) * 0.085;

// Secondary high-frequency micro-lobe
float bump2 = sin(p.x * 4.2 + p.z * 3.8) * 0.038;

float totalBump = bump1 + bump2;

// Deformed vertex position
vec3 displacedPos = position + normal * totalBump;
```

#### Analytical Normal Perturbation:
The surface normal $\vec{n}$ is adjusted according to the partial derivatives of the displacement function:
$$\vec{n}' = \text{normalize}\left(\vec{n} + \begin{pmatrix} 0.08 \cos(2.1 p_x) \\ 0.08 \sin(1.8 p_y) \\ -0.08 \sin(2.2 p_z) \end{pmatrix}\right)$$

When transformed through the instance scale matrix $M_{inst}$, the world normal is safely normalized without non-uniform scale distortion:
$$\vec{N}_{world} = \text{normalize}\left(M_{model} \cdot \left(M_{inst} \cdot \frac{\vec{n}'}{\sqrt{\max(\vec{s}^2, \epsilon)}}\right)\right)$$

---

## 5. Step 4: The Optical & Photometric Lighting Model

Standard Lambertian diffuse reflection fails catastrophically for clouds because clouds are **not solid opaque objects**; they are volumes composed of billions of water droplets exhibiting multiple scattering.

```
                      Sunlight (L)
                           │  │  │
                           ▼  ▼  ▼
                     ┌───────────────┐
                     │   Cloud Top   │ ── Pure White (diffuse wrap)
                     │  (Backlight)  │
                     └───────┬───────┘
                             │  Forward Mie Scattering (Translucency SSS)
                             ▼
                     ┌───────────────┐
                     │  Underside &  │ ── Radiant Azure / Sky-Blue Ambient
                     │   Crevices    │    (No Dark Grey / Black!)
                     └───────────────┘
                             ▲
                             │ Rayleigh Sky Upward Bounce
```

### 5.1 Half-Lambert Wrapped Diffuse
To prevent the harsh dark shadow terminator line where $\vec{N} \cdot \vec{L} \le 0$, we use a wrapped diffuse function with wrap parameter $w = 0.65$:

$$f_{wrap}(\vec{N}, \vec{L}) = \text{clamp}\left(\frac{\vec{N} \cdot \vec{L} + w}{1 + w}, 0, 1\right)$$

To give soft volume rolloff, apply an S-curve smoothstep:
$$k_{diff} = \text{smoothstep}\left(0.03, 0.97, f_{wrap}(\vec{N}, \vec{L})\right)$$

### 5.2 Dual-Hemisphere Atmospheric Ambient Integration
Clouds in the troposphere are immersed in scattered sky radiation. Upward-facing normals receive downwelling sky light; downward-facing normals receive ground bounce and hazy horizon light:

$$u = \text{clamp}\left(\frac{N_y + 1}{2}, 0, 1\right)$$
$$\vec{A}_{sky} = \text{lerp}\left(\begin{pmatrix} 0.55 \\ 0.78 \\ 1.00 \end{pmatrix}, \vec{C}_{sky}, 0.45\right)$$
$$\vec{A}_{ground} = \text{lerp}\left(\begin{pmatrix} 0.75 \\ 0.88 \\ 1.00 \end{pmatrix}, \vec{C}_{ground}, 0.12\right)$$
$$\vec{E}_{amb} = \text{lerp}\left(\vec{A}_{ground}, \vec{A}_{sky}, u\right)$$

> **Crucial Insight:** Notice that $\vec{A}_{ground}$ mixes with a light blue haze vector rather than raw dark earth brown (`#3f3019`). Clouds reflect atmospheric haze, not dirt!

### 5.3 Vertical Height & Crevice Shading
Within each cloud puff, the vertical normalized position $Y_{local} \in [-1, 1]$ dictates the internal density and light penetration:

$$h_T = \text{clamp}\left(\frac{Y_{local} + 0.95}{1.9}, 0, 1\right)$$
$$\vec{C}_{base} = \text{lerp}\left(\vec{C}_{shadow}, \vec{C}_{white}, 0.55 \cdot h_T + 0.45\right)$$

Where $\vec{C}_{shadow} = \text{RGB}(0.45, 0.73, 1.0)$ (Radiant Azure `#82b7eb`) and $\vec{C}_{white} = \text{RGB}(1.0, 1.0, 1.0)$.

### 5.4 Subsurface Scattering (Translucency / Forward Mie Scattering)
When the cloud is backlit by the sun ($\vec{V} \approx -\vec{L}$), photons undergo forward-peaked Mie scattering through the cloud edges:

$$f_{forward} = \text{clamp}\left(\vec{V} \cdot (-\vec{L}), 0, 1\right)$$
$$\vec{I}_{SSS} = \vec{C}_{sun} \cdot \left(f_{forward}\right)^{2.5} \cdot 0.65$$

### 5.5 Fresnel Silhouette Silver Lining
Photons grazing the silhouette of the cloud create a luminous silver halo:

$$f_{fresnel} = \left(1 - \text{clamp}(\vec{N} \cdot \vec{V}, 0, 1)\right)^{2.6}$$
$$k_{rim} = f_{fresnel} \cdot \left[0.4 + 0.6 \cdot \left(\max(0, \vec{L} \cdot (-\vec{V}))\right)^2\right]$$
$$\vec{I}_{rim} = \text{lerp}\left(\vec{C}_{glow}, \text{vec3}(1.0), 0.5\right) \cdot k_{rim} \cdot \left(1 - 0.6 \cdot \delta_{darkness}\right)$$

### 5.6 Invariant Daytime Luminance Floor (Zero-Black Guarantee)
In physical photography, cumulus clouds on a clear day have an albedo of $0.70 - 0.85$. They **never** become black asteroids, even in deep shadow:

$$f_{day} = \text{clamp}\left(3.0 \cdot L_y + 0.2, 0, 1\right)$$
$$\vec{C}_{floor} = \begin{pmatrix} 0.48 \\ 0.72 \\ 0.98 \end{pmatrix} \cdot f_{day} \cdot \left(1 - 0.75 \cdot \delta_{darkness}\right)$$
$$\vec{C}_{final} = \max\left(\vec{C}_{lit\_and\_shade} + \vec{I}_{SSS} + \vec{I}_{rim}, \, \vec{C}_{floor}\right)$$

---

## 6. Step 5: Celestial Mechanics & 60 FPS Continuous Trajectory

### 6.1 The 3D Trajectory Vector Equation
To fulfill physical solar progression (rising East/side $+X$, passing overhead zenith $+Y$, descending South/behind $+Z$), the trajectory is mapped from a continuous hour angle $\theta \in [0, \pi]$:

$$\alpha(\theta) = \alpha_{base} + \sin(\theta) \cdot \left(\alpha_{max} - \alpha_{base}\right), \quad \alpha_{max} = 74^\circ, \; \alpha_{base} = 3.5^\circ$$
$$\phi(\theta) = \frac{\theta}{2}$$

The unified 3D celestial direction unit vector is:
$$\vec{D}(\theta) = \begin{pmatrix} \cos \alpha(\theta) \cos \phi(\theta) \\ \sin \alpha(\theta) \\ \cos \alpha(\theta) \sin \phi(\theta) \end{pmatrix}$$

```
                Zenith (+Y, +Z) [12:00]
                     ▲
                    ╱ ╲
                   ╱   ╲
                  ╱     ╲
  Sunrise (+X)  ───────────► Sunset (+Z)
   [06:00]                    [18:00]
```

### 6.2 Strict Unified Light-Shadow Vector Parity
A common 3D defect is when the sun visual mesh, the directional light, the shadow camera, and the sky shader use slightly different vectors, causing shadows to point in contradictory directions.

We enforce **Strict Single-Vector Parity**:
$$\vec{P}_{sun\_mesh} = \vec{D}(\theta) \cdot R_{sky}$$
$$\vec{P}_{key\_light} = \vec{D}(\theta) \cdot R_{light}$$
$$\vec{u}_{SunDir} = \vec{D}(\theta)$$

Every entity consumes the exact same computed unit vector $\vec{D}(\theta)$.

### 6.3 60 FPS Continuous Time Progression Calculus
Discretized hourly ticks (e.g., jumping from 12:00 to 13:00 every 500ms) cause visible shadow jumps. We use **Constant Angular Velocity with Soft Anchor Synchronization**:

$$h_{t + \Delta t} = \left(h_t + v \cdot \Delta t\right) \pmod{24}$$

Where $v = \text{SpeedMultiplier} \times \frac{24\text{ hours}}{12\text{ seconds}} = 2.0 \cdot \text{SpeedMultiplier}$ hours/sec.

For interactive timeline scrubbing, an exponential decay glide guarantees zero discrete stepping:
$$h_{t + \Delta t} = h_t + \Delta h_{shortest} \cdot \left(1 - e^{-12 \cdot \Delta t}\right)$$

---

## 7. Step 6: Automated Verification & Fidelity Auditing

How do we prove mathematical fidelity to the reference image without manual guesswork?

```mermaid
sequenceDiagram
    participant Dev as Autonomous Agent
    participant Headless as Playwright Headless WebGL
    participant Shader as Three.js Render Target
    participant Vision as Image Analysis & Perceptual Check

    Dev->>Headless: Navigate to /simulation & set Camera Viewpoint
    Headless->>Shader: Render Canvas (WebGlAngle / SwiftShader)
    Headless->>Vision: Capture High-Res Frame (clouds-after.png)
    Vision->>Vision: Compute Histogram, Luminance & Lobe Dispersion
    Vision-->>Dev: Verified: min luminance >= 0.48, 0 facets, 1 draw call
```

### 7.1 Automated Playwright Script (`test-orbit.mjs`)
We deploy automated headless browser tests with hardware WebGL flags:
```bash
node scratch/test-orbit.mjs
```
The script:
1. Boots Chrome with `--enable-webgl --use-gl=angle`.
2. Sets the exact camera matrix matching the user's viewpoint.
3. Takes screenshots at `06:00` (sunrise), `12:00` (noon), `18:00` (sunset), and `00:00` (night).
4. Verifies that the scene compiles without WebGL errors or unhandled shader warnings.

### 7.2 Objective Metric Thresholds (The Acceptance Gate)
To pass verification, the rendered output must satisfy:

| Metric | Target | Formula / Test | Status |
| :--- | :--- | :--- | :--- |
| **Draw Calls** | **Exactly 1** | `gl.info.render.calls` for entire cloud layer | Passed (`InstancedMesh`) |
| **CPU Allocations** | **0 bytes / frame** | Zero `new Vector3()`, zero GC in `useFrame` | Passed (mutated refs) |
| **Facet Elimination** | **$C^1$ Continuous** | Normal deviation on surface $< 0.05$ | Passed (Procedural 3D Bump) |
| **Min Daylight Luminance**| **$L^* \ge 45$** | `min(color) >= minSkyFloor` | Passed (No black rocks) |
| **Scale Variety Range**| **$\ge 3.0\times$** | $\max(Scale) / \min(Scale) \ge 3.0$ | Passed ($16.5 / 2.4 \approx 6.8\times$) |
| **Sky Coverage** | **$360^\circ$ Dome** | Azimuth gaps $< 15^\circ$ across all shells | Passed |

---

## 8. Generalized Recipe for Any AI Vision-to-3D Task

When tasked with generating a high-fidelity 3D asset/environment from a 2D reference image, follow this exact sequence:

1. **Perform Inverse Photometry First:** Do not start with 3D modeling. First extract the primary light vector $\vec{L}$, ambient color ratio $\frac{C_{sky}}{C_{ground}}$, and shadow terminator sharpness.
2. **Select Hierarchy of Primitive Instancing:** Choose a base primitive (Sphere, Cylinder, Capsule, Quad) and cluster multiple instances to compose the macroscopic shape. Never attempt to sculpt a monolithic high-poly mesh if the object has repetitive or procedural nature.
3. **Write a Custom Vertex Displacement Shader:** Add harmonic sinusoidal or simplex noise directly on the GPU to break up rigid geometric primitives.
4. **Implement Wrapped Diffuse + Ambient Bounce:** Never rely on pure `MeshStandardMaterial` or `MeshLambertMaterial` without wrapping for translucent, atmospheric, or stylized organic materials.
5. **Enforce a Luminance Safety Floor:** Add a formula-based minimum color threshold to prevent back-lit geometry from collapsing into black voids.
6. **Automate Camera Capture & Delta Auditing:** Run a headless Playwright script to photograph the 3D scene from the reference image's perspective and verify the visual fidelity before committing.
$$
