import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import BootGate from './components/BootGate'
import { DataProvider } from './data/DataContext'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BootGate>
      <DataProvider>
        <App />
      </DataProvider>
    </BootGate>
  </React.StrictMode>,
)
