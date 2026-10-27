export class AssistantSkinEngine {
  skin: CanvasImageSource | null
  bodyColor: number[] | null
  eyeColor: string | null
  ox: number
  oy: number
  draw(context: CanvasRenderingContext2D, width: number, height: number): void
}
export function drawAssistantAppearance(context: CanvasRenderingContext2D, size: number, pose: AssistantSkinEngine, accent: string, image?: CanvasImageSource | null): void
export function assistantEyeColor(characterColor: string, eyeColor?: string | null): string
