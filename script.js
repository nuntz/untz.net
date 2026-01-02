// Theme Management
const themeBtns = document.querySelectorAll('.theme-btn');
const body = document.body;

function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function setActiveTheme(theme) {
    // Reset classes
    body.classList.remove('theme-light', 'theme-dark');
    
    // Update active button state
    themeBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.theme === theme) {
            btn.classList.add('active');
        }
    });

    // Apply theme
    if (theme === 'system') {
        // No class added, relies on media query
    } else {
        body.classList.add(`theme-${theme}`);
    }

    // Trigger WebGL color update
    if (window.updateMeshTheme) {
        window.updateMeshTheme();
    }
}

themeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const theme = btn.dataset.theme;
        setActiveTheme(theme);
    });
});

// Initialize to System
setActiveTheme('system');

// Watch for system changes if in system mode
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (document.querySelector('.theme-btn[data-theme="system"]').classList.contains('active')) {
        if (window.updateMeshTheme) window.updateMeshTheme();
    }
});


// Three.js Background
// -----------------------------------------------------------------------

const canvas = document.getElementById('webgl-canvas');
const renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
// Camera setup
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 100);
camera.position.set(0, -10, 20);
camera.lookAt(0, 0, 0);

// Geometry - High resolution plane
const geometry = new THREE.PlaneGeometry(60, 40, 128, 128);

// Shader Material
const vertexShader = `
    varying vec2 vUv;
    varying float vElevation;
    varying vec3 vViewPosition;
    
    uniform float uTime;
    uniform float uScrollY; // Not used but good to have
    
    // Simplex noise or sine sum function
    // Simple sine sum for drift
    
    void main() {
        vUv = uv;
        
        vec3 pos = position;
        
        // "Calm zone" - Distance from center (0,0 of the plane)
        // Since UVs are 0..1, center is 0.5.
        // But 'position' is world units centered at 0.
        
        float dist = length(uv - 0.5);
        float calmFactor = smoothstep(0.0, 0.4, dist); // 0 at center, 1 at edges
        
        // Slow ambient drift
        float elevation = 0.0;
        
        // Layer 1: Large gentle swells
        elevation += sin(pos.x * 0.1 + uTime * 0.3) * sin(pos.y * 0.1 + uTime * 0.2) * 2.0;
        
        // Layer 2: Medium detail
        elevation += sin(pos.x * 0.3 - uTime * 0.1) * cos(pos.y * 0.3 + uTime * 0.2) * 1.0;
        
        // Apply calm zone
        // We allow some movement but dampen the height significantly in the center
        // But spec says "Calm zone (readability protection)... reduced contrast/variation"
        // So we reduce the elevation amplitude
        
        // Mix: Full elevation at edges, reduced at center
        // Keep a tiny bit at center so it's not dead flat
        float finalScale = mix(0.1, 1.0, calmFactor);
        
        pos.z += elevation * finalScale;
        
        vElevation = pos.z;
        
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        vViewPosition = -mvPosition.xyz;
        
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const fragmentShader = `
    varying vec2 vUv;
    varying float vElevation;
    varying vec3 vViewPosition;
    
    uniform vec3 uColorBg;
    uniform vec3 uColorAccent;
    
    void main() {
        // Flat shading normals using derivatives
        // This requires 'extensions: { derivatives: true }' on material? 
        // Three.js WebGL 2 does this by default usually.
        // Or we can use standard derivative functions.
        
        vec3 fdx = dFdx(vViewPosition);
        vec3 fdy = dFdy(vViewPosition);
        vec3 normal = normalize(cross(fdx, fdy));
        
        // Light Setup
        // "Directional key light from upper-left"
        // In view space, upper-left is approx (-1, 1, 1)
        vec3 lightDir = normalize(vec3(-1.0, 1.0, 1.0));
        
        // Lambert diffuse
        float diff = max(dot(normal, lightDir), 0.0);
        
        // Specular (Blinn-Phong) - "Broad/soft highlights"
        vec3 viewDir = normalize(vViewPosition);
        vec3 halfDir = normalize(lightDir + viewDir);
        float spec = pow(max(dot(normal, halfDir), 0.0), 16.0); // 16.0 = broad/soft
        
        // Color mixing
        // Base color is bg
        // Mix accent based on elevation or light?
        // Let's mix accent based on lighting intensity to give it that "mesh" feel
        
        vec3 finalColor = mix(uColorBg, uColorAccent, diff * 0.2 + spec * 0.1);
        
        // Add a bit of elevation based coloring for depth
        // Deeper parts (lower Z) slightly darker/more bg colored
        
        gl_FragColor = vec4(finalColor, 1.0);
        
        // Simple linear fog to fade edges (optional, vignette handles most)
    }
`;

const material = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    uniforms: {
        uTime: { value: 0 },
        uColorBg: { value: new THREE.Color('#000000') },
        uColorAccent: { value: new THREE.Color('#ffffff') }
    },
    wireframe: false,
    extensions: {
        derivatives: true // Ensure derivatives work for flat shading
    }
});

const mesh = new THREE.Mesh(geometry, material);
// Rotate to look nice
mesh.rotation.x = -Math.PI / 3.5; 
scene.add(mesh);

// Update Colors Function
function getCSSVar(name) {
    return getComputedStyle(document.body).getPropertyValue(name).trim();
}

window.updateMeshTheme = function() {
    const bg = getCSSVar('--bg');
    const accent = getCSSVar('--mesh-accent');
    
    // We want the mesh to sit 'in' the background, so the base color should match or be close
    // Spec: "Background: ... rendering into explicit canvas... fixed behind content"
    // CSS background is handled by body.
    // WebGL background can be transparent, showing CSS?
    // Spec: "Three.js rendering into an explicit <canvas> element behind content"
    // Spec: "Background: full-bleed edge-to-edge"
    // If I make canvas transparent, I save fillrate and match CSS exactly.
    // BUT the mesh needs to occlude itself or show depth.
    // If the mesh is a surface, it needs a color.
    
    material.uniforms.uColorBg.value.set(bg);
    material.uniforms.uColorAccent.value.set(accent);
    
    // If using transparent canvas, we might want to set scene background to null?
    // It is null by default.
    // But the mesh material needs to be opaque to look like a surface.
};

// Initial color set
// Allow a small delay for CSS to apply if styles load async, 
// though here they are blocking.
setTimeout(window.updateMeshTheme, 0);

// Animation Loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    // Pause if not visible
    if (document.visibilityState !== 'visible') return;

    const elapsedTime = clock.getElapsedTime();
    material.uniforms.uTime.value = elapsedTime;
    
    renderer.render(scene, camera);
}

animate();

// Resize Handler
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        // Update sizes
        const width = window.innerWidth;
        const height = window.innerHeight;
        
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }, 150);
});

// Initial trigger
window.dispatchEvent(new Event('resize'));

// Fade in content
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
});
