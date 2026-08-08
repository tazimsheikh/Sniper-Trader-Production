import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global fetch interceptor to handle silent 401 session expirations
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  // If the server explicitly rejects the request due to missing auth, force a hard reload to trigger the Login UI
  if (response.status === 401) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] instanceof Request ? args[0].url : '');
    if (url.includes('/api/') && !url.includes('/auth/login') && !url.includes('/auth/register') && !url.includes('/auth/me') && !url.includes('/economic-calendar')) {
      console.warn('[Security] Session expired (401). Redirecting to login.');
      window.location.href = '/';
    }
  }
  return response;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
