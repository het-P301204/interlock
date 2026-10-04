import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import { RouterProvider } from 'react-router/dom'
import './fonts.ts'
import './styles.css'
import { router } from './router.tsx'
import { Toaster } from './ui/Toast.tsx'
import './state/ui.ts'

const root = document.getElementById('root')
if (!root) throw new Error('INTERLOCK: #root element missing')

createRoot(root).render(
  <StrictMode>
    {/* "user": motion follows prefers-reduced-motion (transforms dropped, opacity kept). */}
    <MotionConfig reducedMotion="user">
      <RouterProvider router={router} />
      <Toaster />
    </MotionConfig>
  </StrictMode>,
)
