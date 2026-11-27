import { useParams, useSearchParams } from 'react-router-dom'

// Placeholder — replaced by the real viewer implementation.
export default function ViewerPage() {
  const { fileId } = useParams()
  const [params] = useSearchParams()
  return (
    <div className="p-8 text-neutral-500">
      Viewer coming up. file={fileId ?? 'none'} tool={params.get('tool') ?? 'view'}
    </div>
  )
}
