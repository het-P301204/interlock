/**
 * FileDropzone — accessible project-file picker with drag and drop.
 *
 *   <FileDropzone
 *     role="BASELINE" title="Drop a PLC project here" hint="Known-good export"
 *     accept=".L5X,.l5x,.xml" onFile={(file) => inspect(file)}
 *     formats={[{ label: 'L5X', status: 'SUPPORTED' }, { label: 'PLCopen XML', status: 'PLANNED' }]} />
 *
 * A real <input type="file"> sits behind the zone (keyboard: Tab to it, Enter
 * or Space opens the picker; screen readers hear the label and accepted
 * formats). The zone expands on drag-over. Planned formats are listed but
 * marked as not supported.
 */
import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { FileUp } from 'lucide-react'
import { cx } from '../lib/cx.ts'
import { Badge, Glyph } from './Badge.tsx'

export interface FormatTag {
  label: string
  status: 'SUPPORTED' | 'PLANNED'
}

export interface FileDropzoneProps {
  role: string
  title?: string
  hint?: ReactNode
  accept?: string
  onFile: (file: File) => void
  formats?: FormatTag[]
  disabled?: boolean
  compact?: boolean
  className?: string
}

export function FormatList({ formats, className }: { formats: FormatTag[]; className?: string }) {
  const supported = formats.filter((f) => f.status === 'SUPPORTED')
  const planned = formats.filter((f) => f.status === 'PLANNED')
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="il-label">Supported</span>
        {supported.map((f) => (
          <Badge key={f.label} tone="sage" icon={<Glyph shape="check" className="text-sage-ink" />}>
            {f.label}
          </Badge>
        ))}
      </span>
      {planned.length > 0 && (
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="il-label">Planned</span>
          {planned.map((f) => (
            <Badge key={f.label} tone="outline" dashed className="text-ink-3">
              <span className="sr-only">Planned, not supported yet: </span>
              {f.label}
            </Badge>
          ))}
        </span>
      )}
    </div>
  )
}

export function FileDropzone({ role, title = 'Drop a PLC project here', hint, accept = '.L5X,.l5x,.xml', onFile, formats, disabled, compact, className }: FileDropzoneProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const depth = useRef(0)
  const [over, setOver] = useState(false)

  const take = (files: FileList | null) => {
    const f = files?.[0]
    if (f && !disabled) onFile(f)
  }

  return (
    <motion.div
      layout
      transition={{ layout: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
      onDragEnter={(e) => {
        e.preventDefault()
        if (disabled) return
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        take(e.dataTransfer.files)
      }}
      className={cx(
        'group relative flex min-w-0 flex-col rounded-panel border-[1.5px] border-dashed transition-[border-color,background-color,box-shadow] duration-base ease-out-quart',
        'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
        over ? 'border-solid border-ink bg-surface shadow-lift' : 'border-line-strong bg-paper-2/40 hover:border-ink-3 hover:bg-paper-2/70',
        disabled && 'pointer-events-none opacity-55',
        className,
      )}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        aria-describedby={`${id}-desc`}
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ''
        }}
      />
      <label htmlFor={id} className={cx('flex cursor-pointer flex-col items-start gap-4', compact ? 'p-5' : over ? 'px-6 py-14 sm:px-8' : 'px-6 py-10 sm:px-8')}>
        <span className="flex w-full items-center justify-between gap-3">
          <span className="il-label text-ink">{role}</span>
          <motion.span
            aria-hidden="true"
            animate={{ y: over ? -3 : 0 }}
            className={cx('flex size-10 items-center justify-center rounded-control transition-colors duration-base', over ? 'bg-ink text-paper' : 'bg-surface text-ink shadow-inset-line')}
          >
            <FileUp className="size-[18px]" />
          </motion.span>
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-title-3 text-ink">{over ? 'Release to verify this file' : title}</span>
          <span id={`${id}-desc`} className="text-sm text-ink-2">
            {hint}
            {hint ? ' ' : ''}
            <span className="underline decoration-ink-3 underline-offset-4 group-hover:decoration-ink">or choose a file</span>
            <span className="sr-only"> (accepted: {accept})</span>
          </span>
        </span>
      </label>
      {formats && formats.length > 0 && !compact && (
        <div className="border-t border-dashed border-line-strong px-6 py-3.5 sm:px-8">
          <FormatList formats={formats} />
        </div>
      )}
    </motion.div>
  )
}
