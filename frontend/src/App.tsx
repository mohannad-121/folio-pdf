import { lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import NotFound from './pages/NotFound'

// Account / billing pages are split out of the main bundle.
const Pricing = lazy(() => import('./pages/Pricing'))
const Account = lazy(() => import('./pages/Account'))
const AuthPage = lazy(() => import('./pages/AuthPage'))

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>{children}</Suspense>
}
import { ViewerPage } from './viewer'
import { ToolPage } from './tools'

/**
 * Routes. Page transitions (fade + slide, keyed on pathname) live in Layout so the
 * header, nav underline and theme toggle persist across navigations.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        {/* /view/:fileId opens the full viewer/editor for an uploaded file */}
        <Route path="view/:fileId?" element={<ViewerPage />} />
        {/* /tools/:toolId renders a tool page driven by the catalog in lib/tools.ts */}
        <Route path="tools/:toolId" element={<ToolPage />} />
        <Route path="pricing" element={<Lazy><Pricing /></Lazy>} />
        <Route path="account" element={<Lazy><Account /></Lazy>} />
        <Route path="login" element={<Lazy><AuthPage mode="signin" /></Lazy>} />
        <Route path="signup" element={<Lazy><AuthPage mode="signup" /></Lazy>} />
        <Route path="forgot" element={<Lazy><AuthPage mode="forgot" /></Lazy>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
