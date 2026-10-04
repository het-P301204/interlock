/**
 * Left navigation for >= 1024px. Collapses to an icon rail; the state is
 * remembered in localStorage. Labels stay available to assistive technology
 * and as tooltips when collapsed.
 */
import { NavLink } from 'react-router'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { useUi } from '../state/ui.ts'
import { Badge } from '../ui/Badge.tsx'
import { Tooltip } from '../ui/Tooltip.tsx'
import { buttonClasses } from '../ui/Button.tsx'
import { APP_NAV } from './nav.ts'

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const toggle = useUi((s) => s.toggleSidebar)

  return (
    <aside
      aria-label="Workspace navigation"
      className={cx(
        'sticky top-16 hidden h-[calc(100dvh-4rem)] shrink-0 flex-col border-r border-line bg-paper transition-[width] duration-slow ease-out-expo lg:flex',
        collapsed ? 'w-[76px]' : 'w-[248px]',
      )}
    >
      <div className={cx('px-3 pb-2 pt-5', collapsed && 'flex justify-center')}>
        {collapsed ? (
          <Tooltip content="New analysis" side="right" decorative>
            <NavLink to="/app/new" aria-label="New analysis" className={buttonClasses('primary', 'md', 'w-11 px-0')}>
              <Plus />
            </NavLink>
          </Tooltip>
        ) : (
          <NavLink to="/app/new" className={buttonClasses('primary', 'md', 'w-full justify-start')}>
            <Plus />
            <span>New analysis</span>
          </NavLink>
        )}
      </div>

      <nav aria-label="Primary" className="il-scroll-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ul className="flex flex-col gap-0.5">
          {APP_NAV.map((item) => {
            const Icon = item.icon
            const link = (
              <NavLink
                to={item.to}
                end={item.end}
                aria-label={collapsed ? item.label : undefined}
                className={({ isActive }) =>
                  cx(
                    'group relative flex h-10 items-center gap-3 rounded-[12px] text-sm font-semibold transition-colors duration-fast',
                    collapsed ? 'justify-center px-0' : 'px-3',
                    isActive ? 'bg-ink/[0.07] text-ink' : 'text-ink-2 hover:bg-ink/[0.04] hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span aria-hidden="true" className="absolute -left-3 top-2 h-6 w-[3px] rounded-r-full bg-ink" />}
                    <Icon aria-hidden="true" className="size-[18px] shrink-0" strokeWidth={isActive ? 2.2 : 1.8} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {!collapsed && item.badge && (
                      <Badge tone="iris" className="ml-auto h-5 px-2 text-[0.625rem]">
                        {item.badge}
                      </Badge>
                    )}
                  </>
                )}
              </NavLink>
            )
            return (
              <li key={item.to}>
                {collapsed ? (
                  <Tooltip content={item.badge ? `${item.label} (${item.badge})` : item.label} side="right" decorative className="w-max">
                    {link}
                  </Tooltip>
                ) : (
                  link
                )}
              </li>
            )
          })}
        </ul>
      </nav>

      <div className={cx('border-t border-line p-3', collapsed && 'flex justify-center')}>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cx(
            'inline-flex h-9 items-center gap-2 rounded-[12px] text-[0.8125rem] font-semibold text-ink-2 transition-colors hover:bg-ink/[0.05] hover:text-ink',
            collapsed ? 'w-10 justify-center' : 'w-full px-3',
          )}
        >
          {collapsed ? <PanelLeftOpen aria-hidden="true" className="size-[18px]" /> : <PanelLeftClose aria-hidden="true" className="size-[18px]" />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
