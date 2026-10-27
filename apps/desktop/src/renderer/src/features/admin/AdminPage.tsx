import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  Award,
  BadgeCheck,
  ClipboardCheck,
  Images,
  PartyPopper,
  ScrollText,
  ShieldAlert,
  Store,
  Tags,
  Users,
  Wallet,
  Wrench
} from 'lucide-react'
import { useT } from '../../i18n/use-t'
import type { MessageKey } from '../../i18n/resources'
import { supabase } from '../../lib/supabase'
import { Banner, cn } from '../../components/ui'
import { Chip, PageHeader } from '../../components/ui/system'
import { StateEmpty } from '../../components/ui/states'
import { useAdminAccess } from './admin-access'
import { ReviewQueueSection } from './ReviewQueueSection'
import { CatalogSection, type CatalogPrefill } from './CatalogSection'
import { EconomySection } from './EconomySection'
import { BadgesSection } from './BadgesSection'
import { GapsSection } from './GapsSection'
import { AuditSection } from './AuditSection'
import { ModerationSection } from './ModerationSection'
import { VerificationSection } from './VerificationSection'
import { MarketAdminSection } from './MarketAdminSection'
import { HealthSection, UsersSection } from './ConsoleSections'
import { MaintenanceSection } from './MaintenanceSection'
import { CampaignSection } from './CampaignSection'
import { CATALOG_KINDS, type CatalogKind } from './admin-api'
import { LoadingBanner, TabBar } from './admin-ui'

type AdminTab = 'health' | 'maintenance' | 'campaigns' | 'review' | 'moderation' | 'verified' | 'users' | 'market' | 'catalog' | 'currency' | 'badges' | 'gaps' | 'audit'

const CATALOG_LABELS: Record<CatalogKind, MessageKey> = {
  maps: 'admin.maps',
  towers: 'admin.towers',
  mutators: 'admin.mutators',
  tags: 'admin.tags'
}

interface SectionItem {
  id: AdminTab
  labelKey: MessageKey
  hintKey: MessageKey
  icon: LucideIcon
  adminOnly?: boolean
}

/**
 * The console is a workspace, not a tab strip: a persistent left rail says where you are and what the
 * section is for, so an operator switching between a review queue and the shop keeps their bearings.
 */
const SECTIONS: SectionItem[] = [
  { id: 'health', labelKey: 'admin.health', hintKey: 'admin.healthHint', icon: Activity },
  { id: 'maintenance', labelKey: 'admin.maintenance', hintKey: 'admin.maintenanceNavHint', icon: Wrench, adminOnly: true },
  { id: 'campaigns', labelKey: 'admin.campaign', hintKey: 'admin.campaignNavHint', icon: PartyPopper, adminOnly: true },
  { id: 'review', labelKey: 'admin.review', hintKey: 'admin.reviewHint', icon: ClipboardCheck },
  { id: 'moderation', labelKey: 'admin.moderation', hintKey: 'admin.moderationHint', icon: ShieldAlert },
  { id: 'verified', labelKey: 'admin.accounts', hintKey: 'admin.accountsHint', icon: BadgeCheck, adminOnly: true },
  { id: 'users', labelKey: 'admin.users', hintKey: 'admin.usersHint', icon: Users, adminOnly: true },
  { id: 'market', labelKey: 'market.title', hintKey: 'admin.marketHint', icon: Store, adminOnly: true },
  { id: 'catalog', labelKey: 'admin.catalog', hintKey: 'admin.catalogHint', icon: Images, adminOnly: true },
  { id: 'currency', labelKey: 'admin.currency', hintKey: 'admin.currencyHint', icon: Wallet, adminOnly: true },
  { id: 'badges', labelKey: 'admin.badges', hintKey: 'admin.badgesHint', icon: Award, adminOnly: true },
  { id: 'gaps', labelKey: 'admin.gaps', hintKey: 'admin.gapsHint', icon: Tags },
  { id: 'audit', labelKey: 'admin.audit', hintKey: 'admin.auditHint', icon: ScrollText, adminOnly: true }
]

export function AdminPage(): ReactNode {
  const t = useT()
  const access = useAdminAccess()
  const [tab, setTab] = useState<AdminTab>('health')
  const [catalogKind, setCatalogKind] = useState<CatalogKind>('maps')
  const [prefill, setPrefill] = useState<CatalogPrefill | null>(null)

  const handleAddToCatalog = useCallback((next: CatalogPrefill): void => {
    setCatalogKind(next.kind)
    setPrefill(next)
    setTab('catalog')
  }, [])

  const consumePrefill = useCallback((): void => setPrefill(null), [])

  const sections = useMemo(
    () => SECTIONS.filter((section) => !section.adminOnly || access.isAdmin),
    [access.isAdmin]
  )

  const header = (
    <PageHeader
      title={t('admin.title')}
      subtitle={t('admin.subtitle')}
      badges={
        <>
          <Chip tone={access.isAdmin ? 'brand' : 'warn'}>
            {access.isAdmin ? t('admin.roleAdmin') : t('admin.roleModerator')}
          </Chip>
          <Chip tone="neutral">{t('admin.sections', { count: sections.length })}</Chip>
        </>
      }
    />
  )

  // Hooks run first; the gate below is what stops every section query from firing.
  if (!access.ready) {
    return (
      <div className="space-y-4">
        {header}
        <LoadingBanner rows={4} />
      </div>
    )
  }

  if (!access.isModerator) {
    return (
      <div className="space-y-4">
        {header}
        <StateEmpty title={t('admin.notAdmin')} body={t('admin.notAdminHint')} />
      </div>
    )
  }

  if (supabase === null) {
    return (
      <div className="space-y-4">
        {header}
        <Banner tone="warn" title={t('common.errorTitle')}>
          {t('admin.notConfigured')}
        </Banner>
      </div>
    )
  }

  const activeTab: AdminTab = sections.some((item) => item.id === tab) ? tab : 'health'
  const activeSection = sections.find((item) => item.id === activeTab) ?? sections[0]

  return (
    <div className="space-y-4">
      {header}

      <div className="grid gap-4 xl:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="self-start xl:sticky xl:top-4">
          <nav className="hud-panel space-y-0.5 p-1.5">
            {sections.map((section) => {
              const Icon = section.icon
              const active = section.id === activeTab
              return (
                <button
                  key={section.id}
                  type="button"
                  data-press
                  onClick={() => setTab(section.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'no-drag flex w-full items-start gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-brand/15 text-ink ring-1 ring-inset ring-brand/30' : 'text-mute hover:bg-panel-soft hover:text-ink'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border',
                      active ? 'border-brand/40 bg-brand/20 text-brand' : 'border-line bg-panel-soft text-mute'
                    )}
                  >
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium">{t(section.labelKey)}</span>
                    <span className="block truncate text-[10px] leading-snug text-mute/80">{t(section.hintKey)}</span>
                  </span>
                </button>
              )
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex items-center gap-2">
            <span className="hud-label">{activeSection ? t(activeSection.labelKey) : ''}</span>
            <span className="h-1 w-1 rounded-full bg-brand" />
            <span className="hud-label text-mute/60">{activeSection ? t(activeSection.hintKey) : ''}</span>
          </div>

          {activeTab === 'health' ? <HealthSection /> : null}
          {activeTab === 'maintenance' ? <MaintenanceSection /> : null}
          {activeTab === 'campaigns' ? <CampaignSection /> : null}
          {activeTab === 'review' ? <ReviewQueueSection /> : null}
          {activeTab === 'users' ? <UsersSection /> : null}
          {activeTab === 'moderation' ? <ModerationSection /> : null}
          {activeTab === 'verified' ? <VerificationSection /> : null}
          {activeTab === 'market' ? <MarketAdminSection /> : null}

          {activeTab === 'catalog' ? (
            <div className="space-y-3">
              <TabBar
                items={CATALOG_KINDS.map((kind) => ({ id: kind, labelKey: CATALOG_LABELS[kind] }))}
                active={catalogKind}
                onSelect={setCatalogKind}
              />
              <CatalogSection kind={catalogKind} prefill={prefill} onPrefillConsumed={consumePrefill} />
            </div>
          ) : null}

          {activeTab === 'currency' ? <EconomySection /> : null}
          {activeTab === 'badges' ? <BadgesSection /> : null}
          {activeTab === 'gaps' ? <GapsSection onAddToCatalog={handleAddToCatalog} /> : null}
          {activeTab === 'audit' ? <AuditSection /> : null}
        </div>
      </div>
    </div>
  )
}
