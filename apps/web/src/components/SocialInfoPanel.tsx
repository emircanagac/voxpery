import type { MouseEvent, ReactNode } from 'react'
import { ArrowUpRight, ChevronRight, Compass, Heart, Info, Star } from 'lucide-react'
import { openExternalUrl } from '../openExternalUrl'
import { ROUTES } from '../routes'
import { isTauri } from '../secureStorage'
import { useToastStore } from '../stores/toast'
import SocialActivityPanel from './SocialActivityPanel'

function ProjectLink({ href, label, icon, className = '' }: {
  href: string
  label: string
  icon: ReactNode
  className?: string
}) {
  const pushToast = useToastStore((state) => state.pushToast)

  const openLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    void openExternalUrl(href).catch(() => {
      pushToast({ level: 'error', title: `Could not open ${label}`, message: 'Please try again.' })
    })
  }

  return (
    <a className={`social-resource-link ${className}`} href={href} target="_blank" rel="noopener noreferrer" onClick={openLink}>
      {icon}
      <span>{label}</span>
      <ArrowUpRight size={16} className="social-resource-link-trailing" aria-hidden="true" />
    </a>
  )
}

export default function SocialInfoPanel({ onOpenCommunity }: { onOpenCommunity: () => void }) {
  const aboutUrl = isTauri()
    ? 'https://voxpery.com/about'
    : new URL(ROUTES.about, window.location.origin).href

  return (
    <aside className="home-side home-side--resources" aria-label="Voxpery information">
      <SocialActivityPanel />
      <nav className="social-resource-nav" aria-label="Voxpery resources">
        <button type="button" className="social-resource-link" onClick={onOpenCommunity}>
          <Compass size={18} aria-hidden="true" />
          <span>Community</span>
          <ChevronRight size={16} className="social-resource-link-trailing" aria-hidden="true" />
        </button>
        <ProjectLink href="https://github.com/emircanagac/voxpery" label="Star on GitHub"
          icon={<Star size={18} aria-hidden="true" />} className="social-resource-link--star" />
        <ProjectLink href={aboutUrl} label="About Voxpery" icon={<Info size={18} aria-hidden="true" />} />
      </nav>
    </aside>
  )
}

export function ProjectSupportLink() {
  return (
    <ProjectLink href="https://github.com/sponsors/emircanagac" label="Support Voxpery"
      icon={<Heart size={18} aria-hidden="true" />} className="project-support-link" />
  )
}
