export interface TouchReaction { readonly id: string; readonly name: string; readonly group: string; readonly groupName: string; readonly duration: number; readonly weight: number }
export interface TouchPlayState { mood: 'happy' | 'surprised' | 'bothered' | 'angry'; reaction: string | null; paused: boolean; reducedMotion: boolean; sleeping: boolean; version: number }
export type TouchPlayCommand = { type: 'play'; id: string } | { type: 'calm' | 'stop' | 'pause' | 'resume' | 'sleep' | 'wake' }
export const TOUCH_REACTIONS: readonly TouchReaction[]
