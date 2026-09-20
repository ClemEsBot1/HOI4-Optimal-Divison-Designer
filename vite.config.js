import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // the template search runs in a module worker
  worker: { format: 'es' },
});
