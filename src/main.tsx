import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

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

createRoot(root).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
