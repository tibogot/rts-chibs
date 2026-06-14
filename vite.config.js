import { defineConfig } from "vite";

// Virtual modules for CDN imports
const virtualModules = {
  three:
    "export * from 'https://cdn.jsdelivr.net/npm/three@0.183.1/build/three.module.js'",
  "three/tsl":
    "export * from 'https://cdn.jsdelivr.net/npm/three@0.183.1/build/three.tsl.js'",
  "three/webgpu":
    "export * from 'https://cdn.jsdelivr.net/npm/three@0.183.1/build/three.webgpu.js'",
  "stats-gl":
    "export * from 'https://cdn.jsdelivr.net/npm/stats-gl@1.0.9/dist/stats-gl.module.js'",
};

export default defineConfig({
  plugins: [
    {
      name: "virtual-cdn-modules",
      resolveId(id) {
        if (virtualModules[id]) {
          return `\0virtual:${id}`;
        }
        // Handle three/addons/* imports
        if (id.startsWith("three/addons/")) {
          const path = id.replace("three/addons/", "");
          return `\0virtual:${id}`;
        }
      },
      load(id) {
        if (id.startsWith("\0virtual:")) {
          const originalId = id.slice(9); // Remove \0virtual: prefix

          if (originalId.startsWith("three/addons/")) {
            const path = originalId.replace("three/addons/", "");
            return `export * from 'https://cdn.jsdelivr.net/npm/three@0.183.1/examples/jsm/${path}.js'`;
          }

          return virtualModules[originalId] || "";
        }
      },
    },
  ],
  optimizeDeps: {
    exclude: ["three", "three/tsl", "three/webgpu", "three/addons", "stats-gl"],
  },
  build: {
    rollupOptions: {
      external: [
        "three",
        "three/tsl",
        "three/webgpu",
        "three/addons",
        "stats-gl",
      ],
    },
  },
  server: {
    fs: {
      // Allow serving files from the entire project root
      allow: [".."],
    },
  },
});
