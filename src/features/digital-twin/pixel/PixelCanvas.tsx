import { useEffect, useRef } from 'react'
import type { CropProfile, Field } from '../../../domain/digitalTwin/models'
import type { HealthAssessment } from '../../../engine/digitalTwin/healthModel'
import { PixelScene } from './pixelScene'

export interface PixelSceneCanvasProps {
  field: Field
  crop: CropProfile
  health: HealthAssessment
  /** Growth-day scrubber preview, null = the field's real sown day. */
  dayOverride?: number | null
  /** Climate/season preview id, null = the real current-month season. */
  seasonOverride?: string | null
  className?: string
  /** Fires whenever the underlying imperative scene is (re)created or torn
   *  down, so the dashboard can read HUD strings (phase/season/mood) off it. */
  onSceneChange?: (scene: PixelScene | null) => void
}

/**
 * Hosts the ported FieldWatch pixel-art canvas renderer inside React.
 *
 * The renderer (`PixelScene`) owns its own requestAnimationFrame loop and
 * draws imperatively to a `<canvas>` — it predates React and stays that way
 * on purpose, since re-deriving ~700 lines of per-pixel drawing as JSX would
 * buy nothing. React's job here is just lifecycle: create the scene once in
 * a `useEffect` keyed to the canvas ref, destroy it on unmount, and push
 * prop changes into it imperatively via further effects. This is the
 * standard React pattern for hosting an imperative rendering loop.
 */
export function PixelSceneCanvas({
  field,
  crop,
  health,
  dayOverride = null,
  seasonOverride = null,
  className,
  onSceneChange,
}: PixelSceneCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sceneRef = useRef<PixelScene | null>(null)

  // Create/destroy the scene alongside the canvas element itself.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new PixelScene(canvas)
    sceneRef.current = scene
    scene.start()
    onSceneChange?.(scene)
    return () => {
      scene.destroy()
      sceneRef.current = null
      onSceneChange?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.setField(field, crop, health)
  }, [field, crop, health])

  useEffect(() => {
    sceneRef.current?.setDayOverride(dayOverride)
  }, [dayOverride])

  useEffect(() => {
    sceneRef.current?.setSeasonOverride(seasonOverride)
  }, [seasonOverride])

  return <canvas ref={canvasRef} className={className} />
}

export interface PixelThumbnailProps {
  field: Field
  crop: CropProfile
  health: HealthAssessment
  className?: string
}

/** One-shot static thumbnail scene for area cards on the selection screen —
 *  no animation loop, just a single paint. */
export function PixelThumbnail({ field, crop, health, className }: PixelThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const scene = new PixelScene(canvas, { static: true, width: 96, height: 54 })
    scene.setField(field, crop, health)
    return () => scene.destroy()
  }, [field, crop, health])

  return <canvas ref={canvasRef} className={className} />
}
