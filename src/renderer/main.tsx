import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <p className="brand">Dela</p>
      <h1>你的项目工作台</h1>
      <p>尚未创建项目。</p>
      <small>版本 {window.dela.version}</small>
    </main>
  </StrictMode>,
);
