import React from 'react';
import { createRoot } from 'react-dom/client';
import { TrayPanel } from './TrayPanel';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<TrayPanel />);
}
