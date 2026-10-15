import type { OoxmlWorkbook, OoxmlCell } from '../../src/ooxml-readonly-extractor.js'

type Scalar = number | string | boolean
type Value = Scalar | Scalar[][]
type Expression = () => Value

// Test-only interpreter for the source workbook's arithmetic, IF and exact VLOOKUP.
// It evaluates formula text, never the cached results or generated JavaScript.
export function workbookFormulas(workbook: OoxmlWorkbook, inputs: Record<string, Scalar>) {
  const cells = new Map<string, OoxmlCell>(workbook.sheets.flatMap((sheet) => sheet.cells.map((cell) => [`${sheet.name}!${cell.address}`, cell] as const)))
  const cache = new Map<string, Value>(Object.entries(inputs))
  const precedence: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '+': 2, '-': 2, '*': 3, '/': 3 }
  const column = (name: string) => [...name].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0)
  const address = (col: number, row: number) => {
    let name = ''
    for (let value = col; value > 0; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + (value - 1) % 26) + name
    return `${name}${row}`
  }
  function read(reference: string, sheet = 'Hesaplama'): Value {
    const [owner, range] = reference.includes('!') ? reference.split('!') : [sheet, reference]
    const clean = range!.replaceAll('$', '')
    if (clean.includes(':')) {
      const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(clean)!
      return Array.from({ length: Number(match[4]) - Number(match[2]) + 1 }, (_, row) =>
        Array.from({ length: column(match[3]!) - column(match[1]!) + 1 }, (_, col) =>
          read(`${owner}!${address(column(match[1]!) + col, Number(match[2]) + row)}`) as Scalar))
    }
    const key = `${owner}!${clean}`
    if (cache.has(key)) return cache.get(key)!
    const cell = cells.get(key)
    const value = cell?.formula ? parse(cell.formula, owner!)()
      : cell?.type === 'b' ? cell.value === '1'
        : cell?.value == null ? 0
          : cell.type === 's' || cell.type === 'inlineStr' ? cell.value : Number(cell.value)
    cache.set(key, value)
    return value
  }
  function parse(formula: string, sheet: string): Expression {
    const tokens: string[] = []
    const pattern = /\s*("(?:[^"]|"")*"|(?:[\p{L}_][\p{L}\p{N}_]*!)?\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|\d+(?:\.\d+)?|[A-Z]+|<>|<=|>=|[-+*/=<>(),])/uy
    const source = formula.replace(/^=/, '')
    while (pattern.lastIndex < source.length) {
      const match = pattern.exec(source)
      if (!match) throw new Error(`UNSUPPORTED_SOURCE_FORMULA:${formula}`)
      tokens.push(match[1]!)
    }
    let index = 0
    const consume = (expected: string) => {
      if (tokens[index++] !== expected) throw new Error(`SOURCE_FORMULA_TOKEN:${expected}`)
    }
    function expression(minimum = 0): Expression {
      const token = tokens[index++]!
      let left: Expression
      if (token === '(') { left = expression(); consume(')') }
      else if (token === '-') { const inner = expression(4); left = () => -Number(inner()) }
      else if (token.startsWith('"')) left = () => token.slice(1, -1).replaceAll('""', '"')
      else if (/^\d/.test(token)) left = () => Number(token)
      else if (token === 'TRUE' || token === 'FALSE') left = () => token === 'TRUE'
      else if (tokens[index] === '(') {
        index++
        const args: Expression[] = []
        if (tokens[index] !== ')') do { args.push(expression()) } while (tokens[index] === ',' && ++index)
        consume(')')
        left = () => {
          if (token === 'IF') return args[0]!() ? args[1]!() : args[2]!()
          if (token === 'AND') return args.every((arg) => Boolean(arg()))
          if (token === 'OR') return args.some((arg) => Boolean(arg()))
          if (token === 'INT') return Math.floor(Number(args[0]!()))
          if (token === 'VLOOKUP') {
            const row = (args[1]!() as Scalar[][]).find((item) => item[0] === args[0]!())
            if (!row || args[3]!() !== false) throw new Error('SOURCE_VLOOKUP_NOT_EXACT_OR_MISSING')
            return row[Number(args[2]!()) - 1]!
          }
          throw new Error(`UNSUPPORTED_SOURCE_FUNCTION:${token}`)
        }
      } else left = () => read(token, sheet)
      while (index < tokens.length && (precedence[tokens[index]!] ?? -1) >= minimum) {
        const operator = tokens[index++]!
        const right = expression(precedence[operator]! + 1)
        const previous = left
        left = () => {
          const a = previous()
          const b = right()
          switch (operator) {
            case '+': return Number(a) + Number(b)
            case '-': return Number(a) - Number(b)
            case '*': return Number(a) * Number(b)
            case '/': return Number(a) / Number(b)
            case '=': return a === b
            case '<>': return a !== b
            case '<': return a < b
            case '>': return a > b
            case '<=': return a <= b
            case '>=': return a >= b
            default: throw new Error(`SOURCE_OPERATOR:${operator}`)
          }
        }
      }
      return left
    }
    const result = expression()
    if (index !== tokens.length) throw new Error('SOURCE_FORMULA_TRAILING_TOKENS')
    return result
  }
  return (reference: string) => read(reference)
}
