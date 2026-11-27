import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { FileText, Code2 as Github } from 'lucide-react'
import clsx from 'clsx'

export default function Layout() {
  const { pathname } = useLocation()
  const isViewer = pathname.startsWith('/view')
  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-white">
              <FileText size={18} />
            </span>
            Folio
          </Link>
          <nav className="hidden gap-1 text-sm sm:flex">
            <NavItem to="/">All tools</NavItem>
            <NavItem to="/tools/merge">Merge</NavItem>
            <NavItem to="/tools/compress">Compress</NavItem>
            <NavItem to="/tools/pdf-to-word">Convert</NavItem>
            <NavItem to="/tools/edit">Edit</NavItem>
            <NavItem to="/tools/sign">Sign</NavItem>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <a
              href="https://github.com/mohannad-121/folio-pdf"
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-2 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-white"
              aria-label="GitHub"
            >
              <Github size={18} />
            </a>
          </div>
        </div>
      </header>
      <main className={clsx('flex-1', isViewer ? 'min-h-0 overflow-hidden' : 'overflow-auto')}>
        <Outlet />
      </main>
      {!isViewer && (
        <footer className="border-t border-neutral-200 py-6 text-center text-xs text-neutral-500 dark:border-neutral-800">
          Folio PDF — open source, self-hosted. Your files never leave your server.
        </footer>
      )}
    </div>
  )
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'rounded-md px-3 py-1.5 transition',
          isActive ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
        )
      }
    >
      {children}
    </NavLink>
  )
}
