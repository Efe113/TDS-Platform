import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { RESOURCES } from './i18n/resources'
import { ErrorBoundary } from './components/error-boundary'
import { initRendererTelemetry } from './lib/telemetry'
import { App } from './features/shell/App'
import './styles/global.css'

initRendererTelemetry()

void i18next.use(initReactI18next).init({
  resources: RESOURCES,
  lng: 'tr',
  fallbackLng: 'tr',
  supportedLngs: ['tr', 'en'],
  interpolation: { escapeValue: false },
  returnNull: false
})

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } }
})

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </StrictMode>
  )
}
