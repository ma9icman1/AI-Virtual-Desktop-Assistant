import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { installVoiceAutoResume } from './services/voiceAutoResumePatch';

class AppErrorBoundary extends React.Component<React.PropsWithChildren, {error: Error | null}> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ma9icAI renderer error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{minHeight:'100vh',boxSizing:'border-box',padding:'48px',background:'#020611',color:'#eef7ff',fontFamily:'Segoe UI, sans-serif'}}>
          <div style={{maxWidth:900,margin:'0 auto',border:'1px solid #7c2cff',borderRadius:16,padding:28,background:'#061225',boxShadow:'0 0 30px rgba(124,44,255,.18)'}}>
            <h1 style={{margin:'0 0 10px',fontSize:28}}>ma9icAI could not render the interface</h1>
            <p style={{color:'#a9bbd7',lineHeight:1.6}}>The desktop window opened, but the React interface hit an error. The exact error is below.</p>
            <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',padding:16,borderRadius:10,background:'#020914',color:'#ffb4c2',overflow:'auto'}}>{this.state.error.message}\n\n{this.state.error.stack || ''}</pre>
            <p style={{marginBottom:0,color:'#7f96b8',fontSize:13}}>Check the terminal/startup log for the same error, then restart ma9icAI.</p>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('ma9icAI root element is missing.');

installVoiceAutoResume();

// The ma9icAI brain/name control is the always-available emergency stop.
// Keep this in the renderer bootstrap so it survives assistant UI state changes.
const installTopLeftAiKillSwitch = () => {
  let active = false;

  const isAiHeaderControl = (element: Element | null) => {
    if (!element) return false;
    const button = element.closest('button,[role="button"]');
    if (!button) return false;
    const rect = button.getBoundingClientRect();
    if (rect.top > 130 || rect.left > 360 || rect.width <= 0 || rect.height <= 0) return false;

    const ownLabel = `${button.textContent || ''} ${button.getAttribute('aria-label') || ''} ${button.getAttribute('title') || ''}`.toLowerCase();
    const parentLabel = `${button.parentElement?.textContent || ''}`.toLowerCase();
    return /ma9icai/.test(ownLabel) || /ma9icai/.test(parentLabel);
  };

  const markHeaderControl = () => {
    document.querySelectorAll('button,[role="button"]').forEach((element) => {
      if (!isAiHeaderControl(element)) return;
      element.setAttribute('data-ai-kill-target', 'true');
      element.setAttribute('title', 'Emergency stop — stop ma9icAI immediately');
      element.setAttribute('aria-label', 'ma9icAI emergency stop');
    });
  };

  const onClick = (event: MouseEvent) => {
    if (active || !isAiHeaderControl(event.target as Element | null)) return;
    active = true;
    try {
      event.preventDefault();
      event.stopPropagation();
      (window as any).magicDesktop?.emergencyStop?.();
      document.querySelectorAll('[data-ai-kill-target="true"]').forEach((element) => {
        (element as HTMLElement).style.filter = 'brightness(1.8) drop-shadow(0 0 10px rgba(255,70,100,.9))';
      });
      window.setTimeout(() => {
        document.querySelectorAll('[data-ai-kill-target="true"]').forEach((element) => {
          (element as HTMLElement).style.filter = '';
        });
        active = false;
      }, 900);
    } catch (error) {
      console.error('[AI KILL SWITCH] Failed to trigger emergency stop:', error);
      active = false;
    }
  };

  document.addEventListener('click', onClick, true);
  markHeaderControl();
  const observer = new MutationObserver(markHeaderControl);
  observer.observe(document.documentElement, {childList: true, subtree: true});
};

installTopLeftAiKillSwitch();

createRoot(root).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
