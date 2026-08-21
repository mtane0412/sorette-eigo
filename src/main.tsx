/**
 * アプリのエントリーポイント。
 *
 * React のルートを生成し、App コンポーネントを描画します。
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
