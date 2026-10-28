import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { log, warmUpBackend } from './services/api'

log('BOOT', 'main.tsx cargado, montando React app')

// Despertar Render cuanto antes: la identificación facial llega a los ~10-15s del boot
warmUpBackend();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

log('BOOT', 'React render invocado')
