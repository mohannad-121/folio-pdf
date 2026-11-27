import { useParams } from 'react-router-dom'
import { TOOLS_BY_ID } from '../lib/tools'
import NotFound from '../pages/NotFound'

// Placeholder — replaced by the real tool page implementation.
export default function ToolPage() {
  const { toolId } = useParams()
  const tool = toolId ? TOOLS_BY_ID[toolId] : undefined
  if (!tool) return <NotFound />
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">{tool.name}</h1>
      <p className="text-neutral-500">{tool.description}</p>
    </div>
  )
}
