import type { ReactNode } from 'react'
import { Compass, House, SearchX } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { navigate, useRoutePath } from '../../lib/router'
import { Button, PageTitle } from '../../components/ui'
import { StateEmpty } from '../../components/ui/states'

/** An unknown hash used to fall back to the home page silently, so a broken link looked like the app. */
export function NotFoundPage(): ReactNode {
  const t = useT()
  const path = useRoutePath()

  return (
    <div className="space-y-4">
      <PageTitle title={t('app.notFound')} subtitle={t('app.notFoundBody', { path })} />
      <StateEmpty
        icon={SearchX}
        title={t('app.notFound')}
        body={t('app.notFoundHint')}
        action={
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => navigate('/')}>
              <House size={14} />
              {t('nav.home')}
            </Button>
            <Button onClick={() => navigate('/discover')}>
              <Compass size={14} />
              {t('nav.discover')}
            </Button>
          </div>
        }
      />
    </div>
  )
}
