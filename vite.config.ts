import { defineConfig } from 'vite'
import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    dts({ insertTypesEntry: true, include: ["src"] })
  ],
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "ReactSmartAction",
      formats: ["es", "umd"],
      fileName: (format) => `index.${format}.js`
    },
    rolldownOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        globals: {
          "react": "React",
          "react-dom": "ReactDOM"
        }
      }
    }
  }
})
