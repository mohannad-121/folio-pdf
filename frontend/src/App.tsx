import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import NotFound from './pages/NotFound'
import { ViewerPage } from './viewer'
import { ToolPage } from './tools'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        {/* /view/:fileId opens the full viewer/editor for an uploaded file */}
        <Route path="view/:fileId?" element={<ViewerPage />} />
        {/* /tools/:toolId renders a tool page driven by the catalog in lib/tools.ts */}
        <Route path="tools/:toolId" element={<ToolPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
