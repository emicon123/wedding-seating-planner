import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from '@/app/App'
import { queryClient } from '@/app/queryClient'
import { BASE_PATH } from '@/lib/basePath'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={BASE_PATH}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
