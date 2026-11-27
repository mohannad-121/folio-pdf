import * as icons from 'lucide-react'
import type { LucideProps } from 'lucide-react'

/** Resolve a lucide icon by name (used by the tool catalog). */
export default function ToolIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = (icons as unknown as Record<string, React.ComponentType<LucideProps>>)[name] ?? icons.FileText
  return <Icon {...props} />
}
