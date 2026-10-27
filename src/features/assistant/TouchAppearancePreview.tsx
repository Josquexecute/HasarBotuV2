import { useEffect, useRef } from 'react'
import type { AssistantAppearance } from '@hasarbotu/contracts/assistant-appearance'
import { AssistantSkinEngine, drawAssistantAppearance, assistantEyeColor } from '../../../public/desktop-assistant-appearance.js'

export function TouchAppearancePreview({ appearance }: { appearance: AssistantAppearance }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const target = canvas.current
    const context = target?.getContext('2d')
    if (!target || !context) return
    let active = true
    const bot = new AssistantSkinEngine()
    bot.bodyColor = [1, 3, 5].map(i => parseInt(appearance.characterColor.slice(i, i + 2), 16) / 255)
    bot.eyeColor = assistantEyeColor(appearance.characterColor, appearance.eyeColor)
    const draw = (skin?: HTMLImageElement) => {
      if (!active) return
      const ratio = window.devicePixelRatio || 1
      target.width = target.height = Math.round(120 * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      drawAssistantAppearance(context, 120, bot, appearance.accentColor, skin)
      bot.draw(context, 120, 120)
    }
    draw()
    if (appearance.customImage) {
      const image = new Image()
      image.onload = () => { if (active) draw(image) }
      image.src = appearance.customImage
    }
    return () => { active = false }
  }, [appearance])
  return <canvas ref={canvas} className="assistant-skin-preview" width={120} height={120} role="img" aria-label="Touch kaplama önizlemesi" />
}
