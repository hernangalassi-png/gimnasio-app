import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { log } from './services/api'

log('BOOT', 'main.tsx cargado, montando React app')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

log('BOOT', 'React render invocado')
