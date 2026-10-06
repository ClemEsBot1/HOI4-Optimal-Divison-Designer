import React from 'react';
import { createRoot } from 'react-dom/client';
import { inject } from '@vercel/analytics';
import App from './App.jsx';
import './index.css';

inject();

createRoot(document.getElementById('root')).render(<App />);

// installable app: offline support once built (the dev server keeps working without it)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
