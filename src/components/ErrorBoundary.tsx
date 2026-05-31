// @ts-nocheck
import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '20px', background: '#222', color: '#ff5555', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h1>React Runtime Error</h1>
          <p style={{ fontSize: '18px', fontWeight: 'bold' }}>{this.state.error?.toString()}</p>
          <pre style={{ background: '#111', padding: '10px', overflowX: 'auto', marginTop: '20px' }}>
            {this.state.error?.stack}
          </pre>
          <pre style={{ background: '#111', padding: '10px', overflowX: 'auto', marginTop: '20px' }}>
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}
