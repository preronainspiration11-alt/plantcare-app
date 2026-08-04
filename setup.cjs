const fs = require('fs')

fs.writeFileSync('vite.config.js', [
  "import { defineConfig } from 'vite'",
  "import react from '@vitejs/plugin-react'",
  "import tailwindcss from '@tailwindcss/vite'",
  "",
  "export default defineConfig({",
  "  plugins: [react(), tailwindcss()],",
  "})",
].join('\n'))

fs.writeFileSync('src/index.css', [
  "@import 'tailwindcss';",
  "body { font-family: system-ui, sans-serif; }",
].join('\n'))

fs.writeFileSync('src/main.jsx', [
  "import React from 'react'",
  "import ReactDOM from 'react-dom/client'",
  "import App from './App'",
  "import './index.css'",
  "",
  "ReactDOM.createRoot(document.getElementById('root')).render(",
  "  <React.StrictMode><App/></React.StrictMode>",
  ")",
].join('\n'))

fs.mkdirSync('src/lib', { recursive: true })
fs.mkdirSync('src/components', { recursive: true })
fs.mkdirSync('src/pages', { recursive: true })

console.log('All done!')