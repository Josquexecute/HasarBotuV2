import { realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'
import { relativePathSchema } from '@hasarbotu/contracts'

export async function resolveCaseFolder(root: string, relativePath: string): Promise<string> {
  relativePathSchema.parse(relativePath)
  if (!isAbsolute(root)) throw new Error('Klasör kökü mutlak bir yol olmalı.')
  const physicalRoot = await realpath(root)
  const segments = relativePath.split('/')
  // The office profile may point at the year folder while stored paths retain that prefix.
  const rootName = basename(root).normalize('NFC').toLocaleUpperCase('tr-TR')
  const suffix = rootName === segments[0]!.normalize('NFC').toLocaleUpperCase('tr-TR') ? segments.slice(1) : segments
  const target = await realpath(resolve(physicalRoot, ...suffix))
  const inside = relative(physicalRoot, target)
  if (!inside || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new Error('Dosya klasörü seçilen kökün dışında.')
  if (!(await stat(target)).isDirectory()) throw new Error('Dosya klasörü bulunamadı.')
  return target
}

export async function resolveSelectedCaseFolder(selected: string, relativePath: string): Promise<{ target: string; root?: string }> {
  relativePathSchema.parse(relativePath)
  if (!isAbsolute(selected)) throw new Error('Seçilen klasör mutlak bir yol olmalı.')
  const name = (value: string) => value.normalize('NFC').toLocaleUpperCase('tr-TR')
  if (name(basename(selected)) === name(relativePath.split('/').at(-1)!)) {
    const target = await realpath(selected)
    if (!(await stat(target)).isDirectory()) throw new Error('Seçilen konum bir klasör değil.')
    return { target }
  }
  return { target: await resolveCaseFolder(selected, relativePath), root: selected }
}

export async function resolveSavedCaseFolder(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('Kayıtlı dosya klasörü mutlak bir yol olmalı.')
  const target = await realpath(path)
  if (!(await stat(target)).isDirectory()) throw new Error('Kayıtlı konum bir klasör değil.')
  return target
}
