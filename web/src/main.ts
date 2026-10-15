import { mount } from 'svelte';
import App from './App.svelte';
import { loadFonts } from './lib/font';
import { rpc } from './lib/rpc.svelte';
import { installTouchKeyboard } from './lib/touchKeyboard';
import './app.css';

// 100vh includes the mobile address bar, and this page cannot scroll to dismiss
// it, so the bottom row stays clipped. Track the visible height instead.
const trackAppHeight = () => {
  const apply = () => {
    const h = window.visualViewport?.height ?? window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${h}px`);
  };
  apply();
  window.visualViewport?.addEventListener('resize', apply);
  window.addEventListener('resize', apply);
};
trackAppHeight();
installTouchKeyboard();

rpc.connect();
loadFonts().then(() => mount(App, { target: document.getElementById('app')! }));
