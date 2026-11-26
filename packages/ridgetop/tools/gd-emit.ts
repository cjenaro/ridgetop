import ts from 'typescript'
import type { ExportAlias, ModuleAnalysis, ModuleImportBinding } from './gd-analysis.ts'
import {
  containsOwnThis,
  gdString,
  isAssignmentOp,
  safeIdent,
  switchHasOuterContinue,
  unwrapTs
} from './gd-analysis.ts'

export interface HoistFrame {
  readonly indent: string
  readonly lines: string[]
}

/** Explicit mutable emission state threaded through all expression and statement emitters. */
export interface GdEmitContext {
  readonly boxedVars: ReadonlySet<string>
  readonly topFuncs: ReadonlySet<string>
  readonly topVars: ReadonlySet<string>
  readonly exportAliases: readonly ExportAlias[]
  readonly importedBindings: ReadonlyMap<string, ModuleImportBinding>
  readonly scopeStack: Map<string, string>[]
  readonly funcUsedStack: Set<string>[]
  readonly hoistStack: HoistFrame[]
  readonly thisStack: string[]
  readonly switchContStack: (string | null)[]
  tempCounter: number
}

export function createEmitContext(analysis: ModuleAnalysis): GdEmitContext {
  return {
    boxedVars: analysis.boxedVars,
    topFuncs: analysis.topFuncs,
    topVars: analysis.topVars,
    exportAliases: analysis.exportAliases,
    importedBindings: analysis.importedBindings,
    scopeStack: [],
    funcUsedStack: [],
    hoistStack: [],
    thisStack: ['self'],
    switchContStack: [],
    tempCounter: 0
  }
}

const BUILTIN_METHODS: ReadonlySet<string> = new Set([
  'map', 'flatMap', 'filter', 'some', 'every', 'find', 'findIndex', 'forEach', 'reduce',
  'slice', 'subarray', 'set', 'at', 'entries', 'includes', 'indexOf', 'push', 'pop',
  'shift', 'splice', 'sort', 'reverse', 'join', 'toFixed', 'trim', 'toLowerCase', 'toUpperCase',
  'startsWith', 'endsWith', 'split', 'padStart', 'replaceAll'
])

function nextTemp(ctx: GdEmitContext, prefix = '_t'): string {
  return `${prefix}${++ctx.tempCounter}`
}

function makeHoistFrame(indent: string): HoistFrame {
  return { indent, lines: [] }
}

function currentHoist(ctx: GdEmitContext): HoistFrame | undefined {
  return ctx.hoistStack[ctx.hoistStack.length - 1]
}

function pushFuncScope(ctx: GdEmitContext, isNested = false): void {
  ctx.scopeStack.push(new Map())
  const parentUsed = isNested && ctx.funcUsedStack.length ? ctx.funcUsedStack[ctx.funcUsedStack.length - 1] : null
  const base = parentUsed ? new Set(parentUsed) : new Set([...ctx.topVars, ...ctx.topFuncs].map(safeIdent))
  ctx.funcUsedStack.push(base)
}

function popFuncScope(ctx: GdEmitContext): void {
  ctx.scopeStack.pop()
  ctx.funcUsedStack.pop()
}

function pushBlockScope(ctx: GdEmitContext): void {
  ctx.scopeStack.push(new Map())
}

function popBlockScope(ctx: GdEmitContext): void {
  ctx.scopeStack.pop()
}

function withHoist(ctx: GdEmitContext, indent: string, fn: () => string[]): string[] {
  const frame = makeHoistFrame(indent)
  ctx.hoistStack.push(frame)
  try {
    const emitted = fn()
    return [...frame.lines, ...emitted]
  } finally {
    ctx.hoistStack.pop()
  }
}

function declareLocal(ctx: GdEmitContext, raw: string): string {
  const base = safeIdent(raw)
  const used = ctx.funcUsedStack[ctx.funcUsedStack.length - 1]
  if (!used) return base
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base}_${suffix++}`
  }
  used.add(candidate)
  const topScope = ctx.scopeStack[ctx.scopeStack.length - 1]
  if (topScope) topScope.set(raw, candidate)
  return candidate
}

function resolveLocal(ctx: GdEmitContext, raw: string): { id: string; isLocal: boolean } {
  for (let i = ctx.scopeStack.length - 1; i >= 0; i--) {
    const hit = ctx.scopeStack[i].get(raw)
    if (hit) return { id: hit, isLocal: true }
  }
  return { id: safeIdent(raw), isLocal: false }
}

function varRef(ctx: GdEmitContext, name: string): string {
  const { id, isLocal } = resolveLocal(ctx, name)
  return isLocal && ctx.boxedVars.has(name) ? `${id}[0]` : id
}

function formatList(open: string, items: string[], close: string, spacePad = false): string {
  if (!items.length) return `${open}${close}`
  return spacePad ? `${open} ${items.join(', ')} ${close}` : `${open}${items.join(', ')}${close}`
}

function propKeyExpr(ctx: GdEmitContext, name: ts.PropertyName, indent: string): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return gdString(name.text)
  if (ts.isComputedPropertyName(name)) return `RT.norm_key(${emitExpr(ctx, name.expression, indent)})`
  return '""'
}

function emitBindingDecls(ctx: GdEmitContext, name: ts.BindingName, rhsExpr: string, indent: string, isModuleTop: boolean): string[] {
  const lines: string[] = []
  if (ts.isIdentifier(name)) {
    const raw = name.text
    const id = isModuleTop ? safeIdent(raw) : declareLocal(ctx, raw)
    const val = !isModuleTop && ctx.boxedVars.has(raw) ? `[${rhsExpr}]` : rhsExpr
    lines.push(isModuleTop ? `${indent}${id} = ${val}` : `${indent}var ${id} = ${val}`)
    return lines
  }
  const tmp = nextTemp(ctx, '_d')
  lines.push(`${indent}var ${tmp} = ${rhsExpr}`)
  if (ts.isObjectBindingPattern(name)) {
    const excludedKeys: string[] = []
    for (const el of name.elements) {
      if (!ts.isBindingElement(el)) continue
      if (el.dotDotDotToken) {
        const restAccess = `RT.omit_dict(${tmp}, ${formatList('[', excludedKeys, ']')})`
        lines.push(...emitBindingDecls(ctx, el.name, restAccess, indent, isModuleTop))
        continue
      }
      const keyExpr = el.propertyName
        ? propKeyExpr(ctx, el.propertyName, indent)
        : gdString(ts.isIdentifier(el.name) ? el.name.text : '')
      excludedKeys.push(keyExpr)
      let access = `RT.get_prop(${tmp}, ${keyExpr})`
      if (el.initializer) {
        const defExpr = emitExpr(ctx, el.initializer, indent)
        const checkTmp = nextTemp(ctx, '_opt')
        lines.push(`${indent}var ${checkTmp} = ${access}`)
        access = `(${defExpr} if ${checkTmp} == null else ${checkTmp})`
      }
      lines.push(...emitBindingDecls(ctx, el.name, access, indent, isModuleTop))
    }
  } else if (ts.isArrayBindingPattern(name)) {
    for (const [idx, el] of name.elements.entries()) {
      if (ts.isOmittedExpression(el)) continue
      if (el.dotDotDotToken) {
        lines.push(...emitBindingDecls(ctx, el.name, `RT.slice(${tmp}, ${idx})`, indent, isModuleTop))
        continue
      }
      let access = `RT.get_prop(${tmp}, ${idx})`
      if (el.initializer) {
        const defExpr = emitExpr(ctx, el.initializer, indent)
        const checkTmp = nextTemp(ctx, '_opt')
        lines.push(`${indent}var ${checkTmp} = ${access}`)
        access = `(${defExpr} if ${checkTmp} == null else ${checkTmp})`
      }
      lines.push(...emitBindingDecls(ctx, el.name, access, indent, isModuleTop))
    }
  }
  return lines
}

function emitParams(ctx: GdEmitContext, params: readonly ts.ParameterDeclaration[], bodyIndent: string): { sig: string; prelude: string[] } {
  const sigParts: string[] = []
  const prelude: string[] = []
  for (const p of params) {
    if (p.dotDotDotToken) {
      const restSlots: string[] = []
      for (let r = 0; r < 8; r++) {
        const slot = nextTemp(ctx, '_r')
        sigParts.push(`${slot} = RT.UNDEF`)
        restSlots.push(slot)
      }
      const packed = `RT.pack_rest([${restSlots.join(', ')}])`
      prelude.push(...withHoist(ctx, bodyIndent, () => emitBindingDecls(ctx, p.name, packed, bodyIndent, false)))
      continue
    }
    if (ts.isIdentifier(p.name) && !ctx.boxedVars.has(p.name.text)) {
      const id = declareLocal(ctx, p.name.text)
      const initializer = p.initializer
      if (initializer) {
        const tmp = nextTemp(ctx, '_p')
        sigParts.push(`${tmp} = null`)
        prelude.push(...withHoist(ctx, bodyIndent, () => {
          const defVal = emitExpr(ctx, initializer, bodyIndent)
          return [`${bodyIndent}var ${id} = ${defVal} if ${tmp} == null else ${tmp}`]
        }))
      } else {
        sigParts.push(`${id} = null`)
      }
    } else {
      const tmp = nextTemp(ctx, '_p')
      sigParts.push(`${tmp} = null`)
      let src = tmp
      const initializer = p.initializer
      if (initializer) {
        const norm = nextTemp(ctx, '_pn')
        prelude.push(...withHoist(ctx, bodyIndent, () => {
          const defVal = emitExpr(ctx, initializer, bodyIndent)
          return [`${bodyIndent}var ${norm} = ${defVal} if ${tmp} == null else ${tmp}`]
        }))
        src = norm
      }
      prelude.push(...withHoist(ctx, bodyIndent, () => emitBindingDecls(ctx, p.name, src, bodyIndent, false)))
    }
  }
  return { sig: sigParts.join(', '), prelude }
}

function emitLambda(ctx: GdEmitContext, params: readonly ts.ParameterDeclaration[], body: ts.ConciseBody | undefined): string {
  const hoist = currentHoist(ctx)
  const hostIndent = hoist ? hoist.indent : '\t'
  const innerIndent = hostIndent + '\t'
  pushFuncScope(ctx, true)
  try {
    const { sig, prelude } = emitParams(ctx, params, innerIndent)
    let bodyLines: string[]
    if (!body) {
      return `func(${sig}): return null`
    } else if (!ts.isBlock(body)) {
      const exprFrame = makeHoistFrame(innerIndent)
      ctx.hoistStack.push(exprFrame)
      const exprText = emitExpr(ctx, body, innerIndent)
      ctx.hoistStack.pop()
      if (!prelude.length && !exprFrame.lines.length && !exprText.includes('\n')) {
        return `func(${sig}): return ${exprText}`
      }
      bodyLines = [...prelude, ...exprFrame.lines, `${innerIndent}return ${exprText}`]
    } else {
      const stmts = emitBlockStatements(ctx, body.statements, innerIndent)
      if (!prelude.length && !stmts.length) return `func(${sig}): pass`
      bodyLines = [...prelude, ...stmts]
    }
    const fnName = nextTemp(ctx, '_fn')
    const def = `${hostIndent}var ${fnName} = func(${sig}):\n${bodyLines.join('\n')}`
    if (hoist) {
      hoist.lines.push(def)
      return fnName
    }
    return `func(${sig}):\n${bodyLines.join('\n')}`
  } finally {
    popFuncScope(ctx)
  }
}

export function emitExpr(ctx: GdEmitContext, raw: ts.Expression, indent: string, isCallee = false): string {
  const node = unwrapTs(raw)

  if (ts.isNumericLiteral(node)) {
    const text = node.text
    return text.startsWith('.') ? '0' + text : text
  }
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return gdString(node.text)
  }
  if (ts.isTemplateExpression(node)) {
    const parts: string[] = []
    if (node.head.text) parts.push(gdString(node.head.text))
    for (const span of node.templateSpans) {
      parts.push(`RT.js_str(${emitExpr(ctx, span.expression, indent)})`)
      if (span.literal.text) parts.push(gdString(span.literal.text))
    }
    return parts.length ? `(${parts.join(' + ')})` : '""'
  }
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true'
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false'
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'null'
  if (node.kind === ts.SyntaxKind.ThisKeyword) return ctx.thisStack[ctx.thisStack.length - 1]
  if (ts.isIdentifier(node)) {
    if (node.text === 'undefined') return 'null'
    if (node.text === 'Infinity') return 'INF'
    if (node.text === 'NaN') return 'NAN'
    const local = resolveLocal(ctx, node.text)
    if (!local.isLocal && !isCallee) {
      if (node.text === 'globalThis') return '{}'
      if (node.text === 'Boolean') return 'Callable(RT, "truthy")'
      if (node.text === 'Number') return 'Callable(RT, "num")'
      if (node.text === 'String') return 'Callable(RT, "js_str")'
      if (ctx.topFuncs.has(node.text)) {
        return `Callable(self, ${gdString(safeIdent(node.text))})`
      }
    }
    return varRef(ctx, node.text)
  }
  if (ts.isParenthesizedExpression(node)) {
    return `(${emitExpr(ctx, node.expression, indent)})`
  }
  if (ts.isTypeOfExpression(node)) {
    return `RT.type_of(${emitExpr(ctx, node.expression, indent)})`
  }
  if (ts.isArrayLiteralExpression(node)) {
    const itemIndent = indent + '\t'
    const hasSpread = node.elements.some(el => ts.isSpreadElement(el))
    if (!hasSpread) {
      const items = node.elements.map(el => emitExpr(ctx, el, itemIndent))
      return formatList('[', items, ']')
    }
    const parts = node.elements.map(el => ts.isSpreadElement(el) ? emitExpr(ctx, el.expression, itemIndent) : `[${emitExpr(ctx, el, itemIndent)}]`)
    return `RT.spread_arr(${formatList('[', parts, ']')})`
  }
  if (ts.isObjectLiteralExpression(node)) {
    const itemIndent = indent + '\t'
    const hoist = currentHoist(ctx)
    const needsSelfObj = Boolean(hoist && node.properties.some(prop =>
      (ts.isMethodDeclaration(prop) || ts.isGetAccessorDeclaration(prop)) && prop.body && containsOwnThis(prop.body)
    ))
    if (needsSelfObj && hoist) {
      const objVar = nextTemp(ctx, '_obj')
      hoist.lines.push(`${hoist.indent}var ${objVar}: Dictionary = {}`)
      ctx.thisStack.push(objVar)
      try {
        for (const prop of node.properties) {
          if (ts.isSpreadAssignment(prop)) {
            hoist.lines.push(`${hoist.indent}RT.assign(${objVar}, [${emitExpr(ctx, prop.expression, hoist.indent)}])`)
          } else if (ts.isPropertyAssignment(prop)) {
            const key = propKeyExpr(ctx, prop.name, hoist.indent)
            hoist.lines.push(`${hoist.indent}${objVar}[${key}] = ${emitExpr(ctx, prop.initializer, hoist.indent)}`)
          } else if (ts.isShorthandPropertyAssignment(prop)) {
            hoist.lines.push(`${hoist.indent}${objVar}[${gdString(prop.name.text)}] = ${varRef(ctx, prop.name.text)}`)
          } else if (ts.isMethodDeclaration(prop)) {
            const key = propKeyExpr(ctx, prop.name, hoist.indent)
            hoist.lines.push(`${hoist.indent}${objVar}[${key}] = ${emitLambda(ctx, prop.parameters, prop.body)}`)
          } else if (ts.isGetAccessorDeclaration(prop)) {
            const key = propKeyExpr(ctx, prop.name, hoist.indent)
            hoist.lines.push(`${hoist.indent}${objVar}[${key}] = { "__rt_getter": ${emitLambda(ctx, [], prop.body)} }`)
          }
        }
      } finally {
        ctx.thisStack.pop()
      }
      return objVar
    }
    const hasSpread = node.properties.some(p => ts.isSpreadAssignment(p))
    if (!hasSpread) {
      const pairs: string[] = []
      for (const prop of node.properties) {
        if (ts.isPropertyAssignment(prop)) {
          const key = propKeyExpr(ctx, prop.name, itemIndent)
          pairs.push(`${key}: ${emitExpr(ctx, prop.initializer, itemIndent)}`)
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          pairs.push(`${gdString(prop.name.text)}: ${varRef(ctx, prop.name.text)}`)
        } else if (ts.isMethodDeclaration(prop)) {
          const key = propKeyExpr(ctx, prop.name, itemIndent)
          pairs.push(`${key}: ${emitLambda(ctx, prop.parameters, prop.body)}`)
        } else if (ts.isGetAccessorDeclaration(prop)) {
          const key = propKeyExpr(ctx, prop.name, itemIndent)
          pairs.push(`${key}: { "__rt_getter": ${emitLambda(ctx, [], prop.body)} }`)
        }
      }
      return formatList('{', pairs, '}', true)
    }
    const chunks: string[] = []
    let currentPairs: string[] = []
    const flush = () => {
      if (currentPairs.length) {
        chunks.push(formatList('{', currentPairs, '}', true))
        currentPairs = []
      }
    }
    for (const prop of node.properties) {
      if (ts.isSpreadAssignment(prop)) {
        flush()
        chunks.push(emitExpr(ctx, prop.expression, itemIndent))
      } else if (ts.isPropertyAssignment(prop)) {
        currentPairs.push(`${propKeyExpr(ctx, prop.name, itemIndent)}: ${emitExpr(ctx, prop.initializer, itemIndent)}`)
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        currentPairs.push(`${gdString(prop.name.text)}: ${varRef(ctx, prop.name.text)}`)
      } else if (ts.isMethodDeclaration(prop)) {
        currentPairs.push(`${propKeyExpr(ctx, prop.name, itemIndent)}: ${emitLambda(ctx, prop.parameters, prop.body)}`)
      } else if (ts.isGetAccessorDeclaration(prop)) {
        currentPairs.push(`${propKeyExpr(ctx, prop.name, itemIndent)}: { "__rt_getter": ${emitLambda(ctx, [], prop.body)} }`)
      }
    }
    flush()
    return `RT.spread_dict(${formatList('[', chunks, ']')})`
  }
  if (ts.isPrefixUnaryExpression(node)) {
    const op = node.operator
    if (op === ts.SyntaxKind.PlusPlusToken || op === ts.SyntaxKind.MinusMinusToken) {
      const delta: 1 | -1 = op === ts.SyntaxKind.PlusPlusToken ? 1 : -1
      const hoist = currentHoist(ctx)
      if (hoist) {
        const { lines, afterExpr } = emitUnaryMutValue(ctx, node.operand, delta, hoist.indent)
        hoist.lines.push(...lines)
        return afterExpr
      }
      const inner = emitExpr(ctx, node.operand, indent)
      return delta > 0 ? `(${inner} + 1)` : `(${inner} - 1)`
    }
    const inner = emitExpr(ctx, node.operand, indent)
    if (op === ts.SyntaxKind.ExclamationToken) return `(not RT.truthy(${inner}))`
    if (op === ts.SyntaxKind.MinusToken) return `(-(${inner}))`
    if (op === ts.SyntaxKind.PlusToken) return `RT.num(${inner})`
    if (op === ts.SyntaxKind.TildeToken) return `(~int(${inner}))`
  }
  if (ts.isPostfixUnaryExpression(node)) {
    const delta: 1 | -1 = node.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1
    const hoist = currentHoist(ctx)
    if (hoist) {
      const { lines, beforeExpr } = emitUnaryMutValue(ctx, node.operand, delta, hoist.indent)
      hoist.lines.push(...lines)
      return beforeExpr
    }
    return emitExpr(ctx, node.operand, indent)
  }
  if (ts.isConditionalExpression(node)) {
    const hoist = currentHoist(ctx)
    if (hoist) {
      const cond = emitExpr(ctx, node.condition, hoist.indent)
      const res = nextTemp(ctx, '_tern')
      const trueFrame = makeHoistFrame(hoist.indent + '\t')
      ctx.hoistStack.push(trueFrame)
      const tExpr = emitExpr(ctx, node.whenTrue, hoist.indent + '\t')
      ctx.hoistStack.pop()
      const falseFrame = makeHoistFrame(hoist.indent + '\t')
      ctx.hoistStack.push(falseFrame)
      const fExpr = emitExpr(ctx, node.whenFalse, hoist.indent + '\t')
      ctx.hoistStack.pop()
      if (trueFrame.lines.length || falseFrame.lines.length) {
        hoist.lines.push(`${hoist.indent}var ${res} = null`)
        hoist.lines.push(`${hoist.indent}if RT.truthy(${cond}):`)
        hoist.lines.push(...trueFrame.lines, `${hoist.indent}\t${res} = ${tExpr}`)
        hoist.lines.push(`${hoist.indent}else:`)
        hoist.lines.push(...falseFrame.lines, `${hoist.indent}\t${res} = ${fExpr}`)
        return res
      }
      return `((${tExpr}) if RT.truthy(${cond}) else (${fExpr}))`
    }
    return `((${emitExpr(ctx, node.whenTrue, indent)}) if RT.truthy(${emitExpr(ctx, node.condition, indent)}) else (${emitExpr(ctx, node.whenFalse, indent)}))`
  }
  if (ts.isPropertyAccessExpression(node)) {
    const prop = node.name.text
    const target = unwrapTs(node.expression)
    if (ts.isIdentifier(target) && target.text === 'Math') {
      if (prop === 'PI') return 'PI'
      if (prop === 'E') return '2.718281828459045'
      if (prop === 'SQRT2') return '1.4142135623730951'
      if (prop === 'SQRT1_2') return '0.7071067811865476'
      if (prop === 'LN2') return '0.6931471805599453'
      if (prop === 'LN10') return '2.302585092994046'
    }
    if (ts.isIdentifier(target) && target.text === 'Number') {
      if (prop === 'isFinite') return 'Callable(RT, "is_finite_num")'
      if (prop === 'isInteger') return 'Callable(RT, "is_int")'
      if (prop === 'isSafeInteger') return 'Callable(RT, "is_safe_int")'
      if (prop === 'isNaN') return 'Callable(RT, "is_nan_num")'
      if (prop === 'MAX_SAFE_INTEGER') return '9007199254740991'
      if (prop === 'MIN_SAFE_INTEGER') return '-9007199254740991'
      if (prop === 'POSITIVE_INFINITY') return 'INF'
      if (prop === 'NEGATIVE_INFINITY') return '(-INF)'
      if (prop === 'NaN') return 'NAN'
    }
    if (ts.isIdentifier(target) && target.text === 'Array') {
      if (prop === 'isArray') return 'Callable(RT, "is_array")'
    }
    if (prop === 'length') return `RT.prop_len(${emitExpr(ctx, target, indent)})`
    if (prop === 'size') return `RT.prop_size(${emitExpr(ctx, target, indent)})`
    return `RT.get_prop(${emitExpr(ctx, target, indent)}, ${gdString(prop)})`
  }
  if (ts.isElementAccessExpression(node)) {
    return `RT.get_prop(${emitExpr(ctx, node.expression, indent)}, ${emitExpr(ctx, node.argumentExpression, indent)})`
  }
  if (ts.isBinaryExpression(node)) {
    return emitBinary(ctx, node, indent)
  }
  if (ts.isCallExpression(node)) {
    return emitCall(ctx, node, indent)
  }
  if (ts.isNewExpression(node)) {
    const target = unwrapTs(node.expression)
    if (ts.isIdentifier(target)) {
      if (target.text === 'Map' || target.text === 'WeakMap') {
        const arg = node.arguments?.[0] ? emitExpr(ctx, node.arguments[0], indent) : 'null'
        return `RT.make_map(${arg})`
      }
      if (target.text === 'Set') {
        const arg = node.arguments?.[0] ? emitExpr(ctx, node.arguments[0], indent) : 'null'
        return `RT.make_set(${arg})`
      }
      if (target.text === 'Float32Array' || target.text === 'Float64Array' || target.text === 'Int32Array' || target.text === 'Uint16Array' || target.text === 'Uint32Array' || target.text === 'Uint8Array' || target.text === 'Uint8ClampedArray') {
        const arg = node.arguments?.[0] ? emitExpr(ctx, node.arguments[0], indent) : '0'
        return `RT.typed_array(${arg})`
      }
      if (target.text === 'RangeError' || target.text === 'Error' || target.text === 'TypeError') {
        const msg = node.arguments?.[0] ? emitExpr(ctx, node.arguments[0], indent) : '""'
        return `str(${msg})`
      }
    }
    return 'null'
  }
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return emitLambda(ctx, node.parameters, node.body)
  }
  if (ts.isDeleteExpression(node)) {
    const inner = unwrapTs(node.expression)
    if (ts.isPropertyAccessExpression(inner)) {
      return `RT.del_prop(${emitExpr(ctx, inner.expression, indent)}, ${gdString(inner.name.text)})`
    }
    if (ts.isElementAccessExpression(inner)) {
      return `RT.del_prop(${emitExpr(ctx, inner.expression, indent)}, ${emitExpr(ctx, inner.argumentExpression, indent)})`
    }
    return 'true'
  }
  return 'null'
}

function emitBinary(ctx: GdEmitContext, node: ts.BinaryExpression, indent: string): string {
  const op = node.operatorToken.kind
  const hoist = currentHoist(ctx)

  if (op === ts.SyntaxKind.CommaToken) {
    if (hoist) {
      hoist.lines.push(...emitExprStmt(ctx, node.left, hoist.indent))
      return emitExpr(ctx, node.right, hoist.indent)
    }
    return emitExpr(ctx, node.right, indent)
  }

  if (isAssignmentOp(op)) {
    if (hoist) {
      const res = emitAssignValue(ctx, node, hoist.indent)
      hoist.lines.push(...res.lines)
      return res.value
    }
    return emitExpr(ctx, node.right, indent)
  }

  // Short-circuit &&, ||, ?? evaluate LHS exactly once and only evaluate RHS on the taken branch.
  if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
    if (hoist) {
      const L = emitExpr(ctx, node.left, hoist.indent)
      const sc = nextTemp(ctx, '_sc')
      const rhsFrame = makeHoistFrame(hoist.indent + '\t')
      ctx.hoistStack.push(rhsFrame)
      const R = emitExpr(ctx, node.right, hoist.indent + '\t')
      ctx.hoistStack.pop()
      hoist.lines.push(`${hoist.indent}var ${sc} = ${L}`)
      const cond = op === ts.SyntaxKind.AmpersandAmpersandToken
        ? `RT.truthy(${sc})`
        : op === ts.SyntaxKind.BarBarToken
          ? `not RT.truthy(${sc})`
          : `${sc} == null`
      hoist.lines.push(`${hoist.indent}if ${cond}:`)
      hoist.lines.push(...rhsFrame.lines, `${hoist.indent}\t${sc} = ${R}`)
      return sc
    }
    const L = emitExpr(ctx, node.left, indent)
    const R = emitExpr(ctx, node.right, indent)
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return `((${R}) if RT.truthy(${L}) else (${L}))`
    if (op === ts.SyntaxKind.BarBarToken) return `((${L}) if RT.truthy(${L}) else (${R}))`
    return `((${R}) if (${L}) == null else (${L}))`
  }

  const L = emitExpr(ctx, node.left, indent)
  const R = emitExpr(ctx, node.right, indent)

  if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) return `RT.eq(${L}, ${R})`
  if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) return `(not RT.eq(${L}, ${R}))`
  if (op === ts.SyntaxKind.PlusToken) return `RT.add(${L}, ${R})`
  if (op === ts.SyntaxKind.MinusToken) return `(RT.num(${L}) - RT.num(${R}))`
  if (op === ts.SyntaxKind.AsteriskToken) return `(RT.num(${L}) * RT.num(${R}))`
  if (op === ts.SyntaxKind.SlashToken) return `(RT.num(${L}) / RT.num(${R}))`
  if (op === ts.SyntaxKind.PercentToken) return `RT.rem(${L}, ${R})`
  if (op === ts.SyntaxKind.AsteriskAsteriskToken) return `pow(RT.num(${L}), RT.num(${R}))`
  if (op === ts.SyntaxKind.LessThanToken) return `(RT.num(${L}) < RT.num(${R}))`
  if (op === ts.SyntaxKind.LessThanEqualsToken) return `(RT.num(${L}) <= RT.num(${R}))`
  if (op === ts.SyntaxKind.GreaterThanToken) return `(RT.num(${L}) > RT.num(${R}))`
  if (op === ts.SyntaxKind.GreaterThanEqualsToken) return `(RT.num(${L}) >= RT.num(${R}))`
  if (op === ts.SyntaxKind.AmpersandToken) return `(RT.i32(${L}) & RT.i32(${R}))`
  if (op === ts.SyntaxKind.BarToken) return `(RT.i32(${L}) | RT.i32(${R}))`
  if (op === ts.SyntaxKind.CaretToken) return `(RT.i32(${L}) ^ RT.i32(${R}))`
  if (op === ts.SyntaxKind.LessThanLessThanToken) return `RT.i32(RT.i32(${L}) << (RT.i32(${R}) & 31))`
  if (op === ts.SyntaxKind.GreaterThanGreaterThanToken) return `(RT.i32(${L}) >> (RT.i32(${R}) & 31))`
  if (op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken) return `((RT.i32(${L}) & 0xffffffff) >> (RT.i32(${R}) & 31))`
  if (op === ts.SyntaxKind.InKeyword) return `RT.has_prop(${R}, ${L})`
  return `(${L})`
}

function emitCall(ctx: GdEmitContext, node: ts.CallExpression, indent: string): string {
  const callee = unwrapTs(node.expression)
  const hasSpread = node.arguments.some(arg => ts.isSpreadElement(arg))
  const isOptionalCall = Boolean(
    node.questionDotToken ||
    (ts.isPropertyAccessExpression(callee) && callee.questionDotToken) ||
    (ts.isElementAccessExpression(callee) && callee.questionDotToken)
  )
  const invokeFn = isOptionalCall ? 'RT.invoke_opt' : 'RT.invoke'

  const emitArgs = (useIndent: string) => {
    const argIndent = useIndent + '\t'
    const args = node.arguments.map(arg =>
      ts.isSpreadElement(arg) ? emitExpr(ctx, arg.expression, argIndent) : emitExpr(ctx, arg, argIndent)
    )
    const argsArr = hasSpread
      ? `RT.spread_arr(${formatList('[', node.arguments.map((arg, i) => ts.isSpreadElement(arg) ? args[i] : `[${args[i]}]`), ']')})`
      : formatList('[', args, ']')
    const sliceArgsArr = (startIdx: number) => {
      const tailNodes = node.arguments.slice(startIdx)
      const tailExprs = args.slice(startIdx)
      if (!tailNodes.some(arg => ts.isSpreadElement(arg))) return formatList('[', tailExprs, ']')
      return `RT.spread_arr(${formatList('[', tailNodes.map((arg, i) => ts.isSpreadElement(arg) ? tailExprs[i] : `[${tailExprs[i]}]`), ']')})`
    }
    return { args, argsArr, sliceArgsArr }
  }

  const emitGuardedCall = (checkCond: string, build: (useIndent: string) => string): string => {
    const hoist = currentHoist(ctx)
    if (hoist) {
      const resTmp = nextTemp(ctx, '_cr')
      const innerIndent = hoist.indent + '\t'
      const callFrame = makeHoistFrame(innerIndent)
      ctx.hoistStack.push(callFrame)
      const callExpr = build(innerIndent)
      ctx.hoistStack.pop()
      hoist.lines.push(`${hoist.indent}var ${resTmp} = null`)
      hoist.lines.push(`${hoist.indent}if ${checkCond}:`)
      hoist.lines.push(...callFrame.lines, `${innerIndent}${resTmp} = ${callExpr}`)
      return resTmp
    }
    return `(${build(indent)} if ${checkCond} else null)`
  }

  if (ts.isIdentifier(callee)) {
    if (callee.text === 'Number') {
      const { args } = emitArgs(indent)
      return `RT.num(${args[0] ?? '0'})`
    }
    if (callee.text === 'Boolean') {
      const { args } = emitArgs(indent)
      return `RT.truthy(${args[0] ?? 'false'})`
    }
    if (callee.text === 'String') {
      const { args } = emitArgs(indent)
      return `RT.js_str(${args[0] ?? '""'})`
    }
    const local = resolveLocal(ctx, callee.text)
    if (!local.isLocal && ctx.topFuncs.has(callee.text)) {
      const { args, argsArr } = emitArgs(indent)
      if (hasSpread) return `RT.invoke(Callable(self, ${gdString(safeIdent(callee.text))}), ${argsArr})`
      return `${safeIdent(callee.text)}${formatList('(', args, ')')}`
    }
    const fnExpr = varRef(ctx, callee.text)
    if (isOptionalCall) {
      const hoist = currentHoist(ctx)
      if (hoist) {
        const fnTmp = nextTemp(ctx, '_cf')
        hoist.lines.push(`${hoist.indent}var ${fnTmp} = ${fnExpr}`)
        return emitGuardedCall(`${fnTmp} is Callable`, useIndent => {
          const { argsArr } = emitArgs(useIndent)
          return `RT.invoke(${fnTmp}, ${argsArr})`
        })
      }
    }
    const { argsArr } = emitArgs(indent)
    return `${invokeFn}(${fnExpr}, ${argsArr})`
  }

  if (ts.isPropertyAccessExpression(callee)) {
    const objNode = unwrapTs(callee.expression)
    const method = callee.name.text

    // Math.*
    if (ts.isIdentifier(objNode) && objNode.text === 'Math') {
      const { args, argsArr } = emitArgs(indent)
      if (method === 'max') return !hasSpread && args.length === 2 ? `RT.max_two(${args[0]}, ${args[1]})` : `RT.max_all(${argsArr})`
      if (method === 'min') return !hasSpread && args.length === 2 ? `RT.min_two(${args[0]}, ${args[1]})` : `RT.min_all(${argsArr})`
      if (method === 'abs') return `absf(RT.num(${args[0]}))`
      if (method === 'floor') return `floor(RT.num(${args[0]}))`
      if (method === 'ceil') return `ceil(RT.num(${args[0]}))`
      if (method === 'round') return `RT.js_round(${args[0]})`
      if (method === 'trunc') return `RT.js_trunc(${args[0]})`
      if (method === 'sqrt') return `sqrt(RT.num(${args[0]}))`
      if (method === 'sin') return `sin(RT.num(${args[0]}))`
      if (method === 'cos') return `cos(RT.num(${args[0]}))`
      if (method === 'tan') return `tan(RT.num(${args[0]}))`
      if (method === 'asin') return `asin(RT.num(${args[0]}))`
      if (method === 'acos') return `acos(RT.num(${args[0]}))`
      if (method === 'atan') return `atan(RT.num(${args[0]}))`
      if (method === 'atan2') return `atan2(RT.num(${args[0]}), RT.num(${args[1]}))`
      if (method === 'exp') return `exp(RT.num(${args[0]}))`
      if (method === 'log') return `log(RT.num(${args[0]}))`
      if (method === 'log2') return `(log(RT.num(${args[0]})) / log(2.0))`
      if (method === 'log10') return `(log(RT.num(${args[0]})) / log(10.0))`
      if (method === 'pow') return `pow(RT.num(${args[0]}), RT.num(${args[1]}))`
      if (method === 'sign') return `sign(RT.num(${args[0]}))`
      if (method === 'random') return `randf()`
      if (method === 'hypot') return `RT.hypot(${argsArr})`
      if (method === 'imul') return `RT.imul(${args[0]}, ${args[1]})`
    }

    // Number.*
    if (ts.isIdentifier(objNode) && objNode.text === 'Number') {
      const { args } = emitArgs(indent)
      if (method === 'isFinite') return `RT.is_finite_num(${args[0]})`
      if (method === 'isInteger') return `RT.is_int(${args[0]})`
      if (method === 'isSafeInteger') return `RT.is_safe_int(${args[0]})`
      if (method === 'isNaN') return `RT.is_nan_num(${args[0]})`
    }

    // JSON.*
    if (ts.isIdentifier(objNode) && objNode.text === 'JSON') {
      const { args } = emitArgs(indent)
      if (method === 'parse') return `RT.json_parse(${args[0] ?? 'null'})`
      if (method === 'stringify') return `JSON.stringify(${args[0] ?? 'null'})`
    }

    // Object.*
    if (ts.isIdentifier(objNode) && objNode.text === 'Object') {
      const { args, sliceArgsArr } = emitArgs(indent)
      if (method === 'freeze') return args[0] ?? '{}'
      if (method === 'assign') return `RT.assign(${args[0]}, ${sliceArgsArr(1)})`
      if (method === 'keys') return `(${args[0]}).keys()`
      if (method === 'values') return `(${args[0]}).values()`
      if (method === 'entries') return `RT.obj_entries(${args[0]})`
      if (method === 'fromEntries') return `RT.from_entries(${args[0]})`
      if (method === 'hasOwn') return `RT.has_prop(${args[0]}, ${args[1]})`
    }

    // Array.*
    if (ts.isIdentifier(objNode) && objNode.text === 'Array') {
      const { args } = emitArgs(indent)
      if (method === 'isArray') return `(${args[0]} is Array)`
      if (method === 'from') return `RT.arr_from${formatList('(', [args[0], args[1] ?? 'null'], ')')}`
    }

    // Reflect.*
    if (ts.isIdentifier(objNode) && objNode.text === 'Reflect') {
      const { args } = emitArgs(indent)
      if (method === 'apply') return `RT.invoke(${args[0] ?? 'null'}, ${args[2] ?? '[]'})`
      if (method === 'get') return `RT.get_prop(${args[0] ?? 'null'}, ${args[1] ?? 'null'})`
      if (method === 'set') return `(RT.set_prop(${args[0] ?? 'null'}, ${args[1] ?? 'null'}, ${args[2] ?? 'null'}) != null or true)`
    }

    // performance.now()
    if (ts.isIdentifier(objNode) && objNode.text === 'performance' && method === 'now') {
      return 'float(Time.get_ticks_msec())'
    }

    // Evaluate receiver BEFORE arguments (JS evaluation order & optional-chaining short-circuit).
    const obj = emitExpr(ctx, objNode, indent)
    const hoist = currentHoist(ctx)
    const builtinMethod = BUILTIN_METHODS.has(method)

    const emitBuiltin = (o: string, useIndent: string): string => {
      const { args, argsArr, sliceArgsArr } = emitArgs(useIndent)
      if (method === 'map') return `RT.map${formatList('(', [o, args[0]], ')')}`
      if (method === 'flatMap') return `RT.flat_map${formatList('(', [o, args[0]], ')')}`
      if (method === 'filter') return `RT.filter${formatList('(', [o, args[0]], ')')}`
      if (method === 'some') return `RT.some${formatList('(', [o, args[0]], ')')}`
      if (method === 'every') return `RT.every${formatList('(', [o, args[0]], ')')}`
      if (method === 'find') return `RT.find${formatList('(', [o, args[0]], ')')}`
      if (method === 'findIndex') return `RT.find_index${formatList('(', [o, args[0]], ')')}`
      if (method === 'forEach') return `RT.for_each${formatList('(', [o, args[0]], ')')}`
      if (method === 'reduce') return `RT.reduce${formatList('(', [o, args[0], args.length > 1 ? 'true' : 'false', args[1] ?? 'null'], ')')}`
      if (method === 'slice' || method === 'subarray') return `RT.slice(${o}, ${args[0] ?? '0'}, ${args[1] ?? 'null'})`
      if (method === 'set') return `RT.call_set(${o}, ${argsArr})`
      if (method === 'at') return `RT.at(${o}, ${args[0] ?? '0'})`
      if (method === 'entries') return `RT.entries(${o})`
      if (method === 'includes') return `RT.includes(${o}, ${args[0]})`
      if (method === 'indexOf') return `RT.index_of(${o}, ${args[0]}, ${args[1] ?? '0'})`
      if (method === 'push') return `RT.push_many(${o}, ${argsArr})`
      if (method === 'pop') return `RT.pop_arr(${o})`
      if (method === 'shift') return `RT.shift_arr(${o})`
      if (method === 'splice') return `RT.splice_arr(${o}, ${args[0] ?? '0'}, ${args[1] ?? 'null'}, ${sliceArgsArr(2)})`
      if (method === 'sort') return `RT.sort_arr${formatList('(', [o, args[0] ?? 'null'], ')')}`
      if (method === 'reverse') return `RT.reverse_arr(${o})`
      if (method === 'join') return `RT.join_arr(${o}, ${args[0] ?? '","'})`
      if (method === 'toFixed') return `("%." + str(int(${args[0] ?? '0'})) + "f") % RT.num(${o})`
      if (method === 'trim') return `RT.js_str(${o}).strip_edges()`
      if (method === 'toLowerCase') return `RT.js_str(${o}).to_lower()`
      if (method === 'toUpperCase') return `RT.js_str(${o}).to_upper()`
      if (method === 'startsWith') return `RT.js_str(${o}).begins_with(RT.js_str(${args[0] ?? '""'}))`
      if (method === 'endsWith') return `RT.js_str(${o}).ends_with(RT.js_str(${args[0] ?? '""'}))`
      if (method === 'split') return `RT.str_split(${o}, ${args[0] ?? 'null'})`
      if (method === 'padStart') return `RT.str_pad_start(${o}, ${args[0] ?? '0'}, ${args[1] ?? '" "' })`
      return `RT.js_str(${o}).replace(RT.js_str(${args[0] ?? '""'}), RT.js_str(${args[1] ?? '""'}))`
    }

    if (builtinMethod) {
      if (!isOptionalCall) {
        if (hoist && !ts.isIdentifier(objNode) && node.arguments.length > 0) {
          const oc = nextTemp(ctx, '_oc')
          hoist.lines.push(`${hoist.indent}var ${oc} = ${obj}`)
          return emitBuiltin(oc, indent)
        }
        return emitBuiltin(obj, indent)
      }
      if (hoist) {
        const oc = nextTemp(ctx, '_oc')
        hoist.lines.push(`${hoist.indent}var ${oc} = ${obj}`)
        return emitGuardedCall(`${oc} != null`, useIndent => emitBuiltin(oc, useIndent))
      }
      return `(null if (${obj}) == null else ${emitBuiltin(obj, indent)})`
    }

    // General method call on an object / dictionary / module
    if (isOptionalCall && hoist) {
      const oc = nextTemp(ctx, '_oc')
      hoist.lines.push(`${hoist.indent}var ${oc} = ${obj}`)
      if (node.questionDotToken) {
        const fnTmp = nextTemp(ctx, '_cf')
        hoist.lines.push(`${hoist.indent}var ${fnTmp} = null if ${oc} == null else RT.get_prop(${oc}, ${gdString(method)})`)
        return emitGuardedCall(`${fnTmp} is Callable`, useIndent => {
          const { argsArr } = emitArgs(useIndent)
          return `RT.invoke(${fnTmp}, ${argsArr})`
        })
      }
      return emitGuardedCall(`${oc} != null`, useIndent => {
        const { argsArr } = emitArgs(useIndent)
        return `RT.invoke_opt(RT.get_prop(${oc}, ${gdString(method)}), ${argsArr})`
      })
    }
    if (hoist && !ts.isIdentifier(objNode) && node.arguments.length > 0) {
      const oc = nextTemp(ctx, '_oc')
      hoist.lines.push(`${hoist.indent}var ${oc} = ${obj}`)
      const { argsArr } = emitArgs(indent)
      return `${invokeFn}(RT.get_prop(${oc}, ${gdString(method)}), ${argsArr})`
    }
    const { argsArr } = emitArgs(indent)
    return `${invokeFn}(RT.get_prop(${obj}, ${gdString(method)}), ${argsArr})`
  }

  const calleeExpr = emitExpr(ctx, callee, indent)
  const hoist = currentHoist(ctx)
  if (isOptionalCall && hoist) {
    const fnTmp = nextTemp(ctx, '_cf')
    hoist.lines.push(`${hoist.indent}var ${fnTmp} = ${calleeExpr}`)
    return emitGuardedCall(`${fnTmp} is Callable`, useIndent => {
      const { argsArr } = emitArgs(useIndent)
      return `RT.invoke(${fnTmp}, ${argsArr})`
    })
  }
  const { argsArr } = emitArgs(indent)
  return `${invokeFn}(${calleeExpr}, ${argsArr})`
}

function applyAssignOp(op: ts.SyntaxKind, cur: string, val: string): string {
  if (op === ts.SyntaxKind.EqualsToken) return val
  if (op === ts.SyntaxKind.PlusEqualsToken) return `RT.add(${cur}, ${val})`
  if (op === ts.SyntaxKind.MinusEqualsToken) return `(RT.num(${cur}) - RT.num(${val}))`
  if (op === ts.SyntaxKind.AsteriskEqualsToken) return `(RT.num(${cur}) * RT.num(${val}))`
  if (op === ts.SyntaxKind.AsteriskAsteriskEqualsToken) return `pow(RT.num(${cur}), RT.num(${val}))`
  if (op === ts.SyntaxKind.SlashEqualsToken) return `(RT.num(${cur}) / RT.num(${val}))`
  if (op === ts.SyntaxKind.PercentEqualsToken) return `RT.rem(${cur}, ${val})`
  if (op === ts.SyntaxKind.BarEqualsToken) return `(RT.i32(${cur}) | RT.i32(${val}))`
  if (op === ts.SyntaxKind.AmpersandEqualsToken) return `(RT.i32(${cur}) & RT.i32(${val}))`
  if (op === ts.SyntaxKind.CaretEqualsToken) return `(RT.i32(${cur}) ^ RT.i32(${val}))`
  if (op === ts.SyntaxKind.LessThanLessThanEqualsToken) return `RT.i32(RT.i32(${cur}) << (RT.i32(${val}) & 31))`
  if (op === ts.SyntaxKind.GreaterThanGreaterThanEqualsToken) return `(RT.i32(${cur}) >> (RT.i32(${val}) & 31))`
  if (op === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken) return `((RT.i32(${cur}) & 0xffffffff) >> (RT.i32(${val}) & 31))`
  if (op === ts.SyntaxKind.AmpersandAmpersandEqualsToken) return `(${val} if RT.truthy(${cur}) else (${cur}))`
  if (op === ts.SyntaxKind.BarBarEqualsToken) return `((${cur}) if RT.truthy(${cur}) else (${val}))`
  if (op === ts.SyntaxKind.QuestionQuestionEqualsToken) return `(${val} if (${cur}) == null else (${cur}))`
  return val
}

function emitAssignValue(ctx: GdEmitContext, node: ts.BinaryExpression, indent: string): { lines: string[]; value: string } {
  const op = node.operatorToken.kind
  const lhs = unwrapTs(node.left)

  // Logical assignments (&&=, ||=, ??=) must short-circuit RHS evaluation and avoid redundant set_prop.
  if (op === ts.SyntaxKind.AmpersandAmpersandEqualsToken || op === ts.SyntaxKind.BarBarEqualsToken || op === ts.SyntaxKind.QuestionQuestionEqualsToken) {
    const condFor = (cur: string) =>
      op === ts.SyntaxKind.AmpersandAmpersandEqualsToken ? `RT.truthy(${cur})`
        : op === ts.SyntaxKind.BarBarEqualsToken ? `not RT.truthy(${cur})`
          : `${cur} == null`
    const evalRhs = (bodyIndent: string) => {
      const rhsFrame = makeHoistFrame(bodyIndent)
      ctx.hoistStack.push(rhsFrame)
      try {
        const rhs: { lines: string[]; value: string } = ts.isBinaryExpression(node.right) && isAssignmentOp(node.right.operatorToken.kind)
          ? emitAssignValue(ctx, node.right, bodyIndent)
          : { lines: [], value: emitExpr(ctx, node.right, bodyIndent) }
        return { lines: [...rhsFrame.lines, ...rhs.lines], value: rhs.value }
      } finally {
        ctx.hoistStack.pop()
      }
    }
    if (ts.isIdentifier(lhs)) {
      const target = varRef(ctx, lhs.text)
      const rhs = evalRhs(indent + '\t')
      return {
        lines: [
          `${indent}if ${condFor(target)}:`,
          ...rhs.lines,
          `${indent}\t${target} = ${rhs.value}`
        ],
        value: target
      }
    } else if (ts.isPropertyAccessExpression(lhs)) {
      const objTmp = nextTemp(ctx, '_ao')
      const curTmp = nextTemp(ctx, '_ac')
      const key = gdString(lhs.name.text)
      const rhs = evalRhs(indent + '\t')
      return {
        lines: [
          `${indent}var ${objTmp} = ${emitExpr(ctx, lhs.expression, indent)}`,
          `${indent}var ${curTmp} = RT.get_prop(${objTmp}, ${key})`,
          `${indent}if ${condFor(curTmp)}:`,
          ...rhs.lines,
          `${indent}\t${curTmp} = RT.set_prop(${objTmp}, ${key}, ${rhs.value})`
        ],
        value: curTmp
      }
    } else if (ts.isElementAccessExpression(lhs)) {
      const objTmp = nextTemp(ctx, '_ao')
      const keyTmp = nextTemp(ctx, '_ak')
      const curTmp = nextTemp(ctx, '_ac')
      const rhs = evalRhs(indent + '\t')
      return {
        lines: [
          `${indent}var ${objTmp} = ${emitExpr(ctx, lhs.expression, indent)}`,
          `${indent}var ${keyTmp} = ${emitExpr(ctx, lhs.argumentExpression, indent)}`,
          `${indent}var ${curTmp} = RT.get_prop(${objTmp}, ${keyTmp})`,
          `${indent}if ${condFor(curTmp)}:`,
          ...rhs.lines,
          `${indent}\t${curTmp} = RT.set_prop(${objTmp}, ${keyTmp}, ${rhs.value})`
        ],
        value: curTmp
      }
    }
  }

  const capture = (fn: () => string): { lines: string[]; value: string } => {
    const frame = makeHoistFrame(indent)
    ctx.hoistStack.push(frame)
    try {
      const value = fn()
      return { lines: frame.lines, value }
    } finally {
      ctx.hoistStack.pop()
    }
  }

  const emitRhs = (): { lines: string[]; value: string } => {
    const unwrappedRight = unwrapTs(node.right)
    if (ts.isBinaryExpression(unwrappedRight) && isAssignmentOp(unwrappedRight.operatorToken.kind)) {
      const frame = makeHoistFrame(indent)
      ctx.hoistStack.push(frame)
      try {
        const res = emitAssignValue(ctx, unwrappedRight, indent)
        return { lines: [...frame.lines, ...res.lines], value: res.value }
      } finally {
        ctx.hoistStack.pop()
      }
    }
    return capture(() => emitExpr(ctx, node.right, indent))
  }

  if (ts.isIdentifier(lhs)) {
    const rhs = emitRhs()
    const lines = [...rhs.lines]
    const target = varRef(ctx, lhs.text)
    lines.push(`${indent}${target} = ${applyAssignOp(op, target, rhs.value)}`)
    return { lines, value: target }
  } else if (ts.isPropertyAccessExpression(lhs)) {
    const objTmp = nextTemp(ctx, '_ao')
    const objCap = capture(() => emitExpr(ctx, lhs.expression, indent))
    const lines: string[] = [...objCap.lines, `${indent}var ${objTmp} = ${objCap.value}`]
    const rhs = emitRhs()
    lines.push(...rhs.lines)
    const key = gdString(lhs.name.text)
    const valTmp = nextTemp(ctx, '_av')
    const nextVal = op === ts.SyntaxKind.EqualsToken ? rhs.value : applyAssignOp(op, `RT.get_prop(${objTmp}, ${key})`, rhs.value)
    lines.push(`${indent}var ${valTmp} = RT.set_prop(${objTmp}, ${key}, ${nextVal})`)
    return { lines, value: valTmp }
  } else if (ts.isElementAccessExpression(lhs)) {
    const objTmp = nextTemp(ctx, '_ao')
    const keyTmp = nextTemp(ctx, '_ak')
    const objCap = capture(() => emitExpr(ctx, lhs.expression, indent))
    const keyCap = capture(() => emitExpr(ctx, lhs.argumentExpression, indent))
    const lines: string[] = [
      ...objCap.lines,
      `${indent}var ${objTmp} = ${objCap.value}`,
      ...keyCap.lines,
      `${indent}var ${keyTmp} = ${keyCap.value}`
    ]
    const rhs = emitRhs()
    lines.push(...rhs.lines)
    const valTmp = nextTemp(ctx, '_av')
    const nextVal = op === ts.SyntaxKind.EqualsToken ? rhs.value : applyAssignOp(op, `RT.get_prop(${objTmp}, ${keyTmp})`, rhs.value)
    lines.push(`${indent}var ${valTmp} = RT.set_prop(${objTmp}, ${keyTmp}, ${nextVal})`)
    return { lines, value: valTmp }
  }
  const rhs = emitRhs()
  return { lines: [...rhs.lines], value: rhs.value }
}

function emitAssignStmt(ctx: GdEmitContext, node: ts.BinaryExpression, indent: string): string[] {
  return emitAssignValue(ctx, node, indent).lines
}

function emitUnaryMutValue(ctx: GdEmitContext, operand: ts.Expression, delta: 1 | -1, indent: string): { lines: string[]; beforeExpr: string; afterExpr: string } {
  const lhs = unwrapTs(operand)
  const sign = delta > 0 ? '+ 1' : '- 1'
  if (ts.isIdentifier(lhs)) {
    const target = varRef(ctx, lhs.text)
    const oldTmp = nextTemp(ctx, '_u')
    return {
      lines: [`${indent}var ${oldTmp} = ${target}`, `${indent}${target} = RT.num(${oldTmp}) ${sign}`],
      beforeExpr: oldTmp,
      afterExpr: target
    }
  }
  if (ts.isPropertyAccessExpression(lhs)) {
    const objTmp = nextTemp(ctx, '_uo')
    const oldTmp = nextTemp(ctx, '_u')
    const newTmp = nextTemp(ctx, '_un')
    const key = gdString(lhs.name.text)
    return {
      lines: [
        `${indent}var ${objTmp} = ${emitExpr(ctx, lhs.expression, indent)}`,
        `${indent}var ${oldTmp} = RT.get_prop(${objTmp}, ${key})`,
        `${indent}var ${newTmp} = RT.num(${oldTmp}) ${sign}`,
        `${indent}RT.set_prop(${objTmp}, ${key}, ${newTmp})`
      ],
      beforeExpr: oldTmp,
      afterExpr: newTmp
    }
  }
  if (ts.isElementAccessExpression(lhs)) {
    const objTmp = nextTemp(ctx, '_uo')
    const keyTmp = nextTemp(ctx, '_uk')
    const oldTmp = nextTemp(ctx, '_u')
    const newTmp = nextTemp(ctx, '_un')
    return {
      lines: [
        `${indent}var ${objTmp} = ${emitExpr(ctx, lhs.expression, indent)}`,
        `${indent}var ${keyTmp} = ${emitExpr(ctx, lhs.argumentExpression, indent)}`,
        `${indent}var ${oldTmp} = RT.get_prop(${objTmp}, ${keyTmp})`,
        `${indent}var ${newTmp} = RT.num(${oldTmp}) ${sign}`,
        `${indent}RT.set_prop(${objTmp}, ${keyTmp}, ${newTmp})`
      ],
      beforeExpr: oldTmp,
      afterExpr: newTmp
    }
  }
  return { lines: [], beforeExpr: 'null', afterExpr: 'null' }
}

function emitUnaryMutStmt(ctx: GdEmitContext, operand: ts.Expression, delta: 1 | -1, indent: string): string[] {
  return emitUnaryMutValue(ctx, operand, delta, indent).lines
}

function emitScopedBody(ctx: GdEmitContext, stmt: ts.Statement, indent: string): string[] {
  pushBlockScope(ctx)
  try {
    return ts.isBlock(stmt)
      ? emitBlockStatements(ctx, stmt.statements, indent)
      : emitStmt(ctx, stmt, indent)
  } finally {
    popBlockScope(ctx)
  }
}

function emitExprStmt(ctx: GdEmitContext, expr: ts.Expression, indent: string): string[] {
  const node = unwrapTs(expr)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return [...emitExprStmt(ctx, node.left, indent), ...emitExprStmt(ctx, node.right, indent)]
  }
  if (ts.isBinaryExpression(node) && isAssignmentOp(node.operatorToken.kind)) {
    return emitAssignStmt(ctx, node, indent)
  }
  if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
    if (node.operator === ts.SyntaxKind.PlusPlusToken) return emitUnaryMutStmt(ctx, node.operand, 1, indent)
    if (node.operator === ts.SyntaxKind.MinusMinusToken) return emitUnaryMutStmt(ctx, node.operand, -1, indent)
  }
  return [`${indent}${emitExpr(ctx, node, indent)}`]
}

function emitBlockStatements(ctx: GdEmitContext, stmts: readonly ts.Statement[], indent: string): string[] {
  const out: string[] = []
  for (const stmt of stmts) out.push(...emitStmt(ctx, stmt, indent, false))
  return out
}

export function emitStmt(ctx: GdEmitContext, stmt: ts.Statement, indent: string, isModuleTop = false): string[] {
  if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isImportDeclaration(stmt) || ts.isEmptyStatement(stmt)) {
    return []
  }
  if (ts.isVariableStatement(stmt)) {
    const out: string[] = []
    for (const decl of stmt.declarationList.declarations) {
      const declInit = decl.initializer
      if (!isModuleTop && ts.isIdentifier(decl.name) && ctx.boxedVars.has(decl.name.text) && declInit) {
        let init = declInit
        while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          const fnName = declareLocal(ctx, decl.name.text)
          out.push(`${indent}var ${fnName} = [null]`)
          out.push(...withHoist(ctx, indent, () => {
            const lam = emitExpr(ctx, declInit, indent)
            return [`${indent}${fnName}[0] = ${lam}`]
          }))
          continue
        }
      }
      out.push(...withHoist(ctx, indent, () => {
        const rhs = decl.initializer ? emitExpr(ctx, decl.initializer, indent) : 'null'
        return emitBindingDecls(ctx, decl.name, rhs, indent, isModuleTop)
      }))
    }
    return out
  }
  if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    if (isModuleTop) return [] // Emitted as top-level `func` below
    const rawName = stmt.name.text
    const isBoxed = ctx.boxedVars.has(rawName)
    const fnName = declareLocal(ctx, rawName)
    if (isBoxed) {
      const declLine = `${indent}var ${fnName} = [null]`
      const initLines = withHoist(ctx, indent, () => {
        const lam = emitLambda(ctx, stmt.parameters, stmt.body)
        return [`${indent}${fnName}[0] = ${lam}`]
      })
      return [declLine, ...initLines]
    }
    return withHoist(ctx, indent, () => {
      const lam = emitLambda(ctx, stmt.parameters, stmt.body)
      return [`${indent}var ${fnName} = ${lam}`]
    })
  }
  if (ts.isReturnStatement(stmt)) {
    return withHoist(ctx, indent, () => [stmt.expression ? `${indent}return ${emitExpr(ctx, stmt.expression, indent)}` : `${indent}return`])
  }
  if (ts.isBreakStatement(stmt)) return [`${indent}break`]
  if (ts.isContinueStatement(stmt)) {
    const swCont = ctx.switchContStack[ctx.switchContStack.length - 1]
    if (swCont) return [`${indent}${swCont} = true`, `${indent}break`]
    return [`${indent}continue`]
  }
  if (ts.isThrowStatement(stmt)) {
    return withHoist(ctx, indent, () => [`${indent}assert(false, str(${emitExpr(ctx, stmt.expression, indent)}))`])
  }
  if (ts.isIfStatement(stmt)) {
    const condLines = withHoist(ctx, indent, () => [`${indent}if RT.truthy(${emitExpr(ctx, stmt.expression, indent)}):`])
    const lines = [...condLines]
    const thenBody = emitScopedBody(ctx, stmt.thenStatement, indent + '\t')
    lines.push(...(thenBody.length ? thenBody : [`${indent}\tpass`]))
    if (stmt.elseStatement) {
      if (ts.isIfStatement(stmt.elseStatement)) {
        const elifLines = emitStmt(ctx, stmt.elseStatement, indent)
        if (elifLines[0]?.startsWith(`${indent}if `)) {
          elifLines[0] = elifLines[0].replace(/^(\t*)if /, '$1elif ')
          lines.push(...elifLines)
        } else {
          lines.push(`${indent}else:`)
          lines.push(...elifLines.flatMap(line => line.split('\n').map(sub => '\t' + sub)))
        }
      } else {
        lines.push(`${indent}else:`)
        const elseBody = emitScopedBody(ctx, stmt.elseStatement, indent + '\t')
        lines.push(...(elseBody.length ? elseBody : [`${indent}\tpass`]))
      }
    }
    return lines
  }
  if (ts.isSwitchStatement(stmt)) {
    const disc = nextTemp(ctx, '_sw')
    const idxVar = nextTemp(ctx, '_swi')
    const lines = withHoist(ctx, indent, () => [
      `${indent}var ${disc} = ${emitExpr(ctx, stmt.expression, indent)}`,
      `${indent}var ${idxVar} := -1`
    ])
    const clauses = stmt.caseBlock.clauses
    let defaultIndex = -1
    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i]
      if (ts.isDefaultClause(clause)) {
        defaultIndex = i
        continue
      }
      const checkLines = withHoist(ctx, indent + '\t', () => [
        `${indent}\tif RT.eq(${disc}, ${emitExpr(ctx, clause.expression, indent + '\t')}):`,
        `${indent}\t\t${idxVar} = ${i}`
      ])
      lines.push(`${indent}if ${idxVar} == -1:`, ...checkLines)
    }
    if (defaultIndex >= 0) {
      lines.push(`${indent}if ${idxVar} == -1:`, `${indent}\t${idxVar} = ${defaultIndex}`)
    }
    const needsCont = switchHasOuterContinue(stmt.caseBlock)
    const contFlag = needsCont ? nextTemp(ctx, '_swc') : null
    if (contFlag) lines.push(`${indent}var ${contFlag} := false`)
    lines.push(`${indent}while true:`)
    ctx.switchContStack.push(contFlag)
    try {
      for (let i = 0; i < clauses.length; i++) {
        pushBlockScope(ctx)
        const body = emitBlockStatements(ctx, clauses[i].statements, indent + '\t\t')
        popBlockScope(ctx)
        if (body.length) {
          lines.push(`${indent}\tif ${idxVar} >= 0 and ${idxVar} <= ${i}:`)
          lines.push(...body)
        }
      }
    } finally {
      ctx.switchContStack.pop()
    }
    lines.push(`${indent}\tbreak`)
    if (contFlag) {
      const outerSwCont = ctx.switchContStack[ctx.switchContStack.length - 1]
      lines.push(`${indent}if ${contFlag}:`)
      if (outerSwCont) {
        lines.push(`${indent}\t${outerSwCont} = true`)
        lines.push(`${indent}\tbreak`)
      } else {
        lines.push(`${indent}\tcontinue`)
      }
    }
    return lines
  }
  if (ts.isForOfStatement(stmt)) {
    pushBlockScope(ctx)
    ctx.switchContStack.push(null)
    try {
      const loopVar = nextTemp(ctx, '_el')
      const header = withHoist(ctx, indent, () => [`${indent}for ${loopVar} in RT.iter(${emitExpr(ctx, stmt.expression, indent)}):`])
      const lines = [...header]
      if (ts.isVariableDeclarationList(stmt.initializer)) {
        const decl = stmt.initializer.declarations[0]
        lines.push(...withHoist(ctx, indent + '\t', () => emitBindingDecls(ctx, decl.name, loopVar, indent + '\t', false)))
      } else if (ts.isIdentifier(stmt.initializer)) {
        lines.push(`${indent}\t${varRef(ctx, stmt.initializer.text)} = ${loopVar}`)
      }
      const body = emitScopedBody(ctx, stmt.statement, indent + '\t')
      lines.push(...(body.length ? body : [`${indent}\tpass`]))
      return lines
    } finally {
      ctx.switchContStack.pop()
      popBlockScope(ctx)
    }
  }
  if (ts.isForInStatement(stmt)) {
    pushBlockScope(ctx)
    ctx.switchContStack.push(null)
    try {
      const loopVar = nextTemp(ctx, '_k')
      const srcVar = nextTemp(ctx, '_obj')
      const header = withHoist(ctx, indent, () => [
        `${indent}var ${srcVar} = ${emitExpr(ctx, stmt.expression, indent)}`,
        `${indent}for ${loopVar} in (${srcVar}.keys() if ${srcVar} is Dictionary else range(RT.len_of(${srcVar}))):`
      ])
      const lines = [...header]
      if (ts.isVariableDeclarationList(stmt.initializer)) {
        const decl = stmt.initializer.declarations[0]
        lines.push(...withHoist(ctx, indent + '\t', () => emitBindingDecls(ctx, decl.name, `RT.js_str(${loopVar})`, indent + '\t', false)))
      } else if (ts.isIdentifier(stmt.initializer)) {
        lines.push(`${indent}\t${varRef(ctx, stmt.initializer.text)} = RT.js_str(${loopVar})`)
      }
      const body = emitScopedBody(ctx, stmt.statement, indent + '\t')
      lines.push(...(body.length ? body : [`${indent}\tpass`]))
      return lines
    } finally {
      ctx.switchContStack.pop()
      popBlockScope(ctx)
    }
  }
  if (ts.isForStatement(stmt)) {
    pushBlockScope(ctx)
    ctx.switchContStack.push(null)
    try {
      const lines: string[] = []
      const initializer = stmt.initializer
      if (initializer) {
        if (ts.isVariableDeclarationList(initializer)) {
          lines.push(...withHoist(ctx, indent, () => {
            const initOut: string[] = []
            for (const decl of initializer.declarations) {
              initOut.push(...emitBindingDecls(ctx, decl.name, decl.initializer ? emitExpr(ctx, decl.initializer, indent) : 'null', indent, false))
            }
            return initOut
          }))
        } else {
          lines.push(...withHoist(ctx, indent, () => emitExprStmt(ctx, initializer, indent)))
        }
      }
      const incrementor = stmt.incrementor
      const condition = stmt.condition
      if (incrementor) {
        const firstFlag = nextTemp(ctx, '_f')
        lines.push(`${indent}var ${firstFlag} := true`)
        lines.push(`${indent}while true:`)
        lines.push(`${indent}\tif ${firstFlag}:`)
        lines.push(`${indent}\t\t${firstFlag} = false`)
        lines.push(`${indent}\telse:`)
        lines.push(...withHoist(ctx, indent + '\t\t', () => emitExprStmt(ctx, incrementor, indent + '\t\t')))
        if (condition) {
          lines.push(...withHoist(ctx, indent + '\t', () => [
            `${indent}\tif not RT.truthy(${emitExpr(ctx, condition, indent + '\t')}):`,
            `${indent}\t\tbreak`
          ]))
        }
        const body = emitScopedBody(ctx, stmt.statement, indent + '\t')
        lines.push(...(body.length ? body : [`${indent}\tpass`]))
      } else {
        lines.push(`${indent}while true:`)
        if (condition) {
          lines.push(...withHoist(ctx, indent + '\t', () => [
            `${indent}\tif not RT.truthy(${emitExpr(ctx, condition, indent + '\t')}):`,
            `${indent}\t\tbreak`
          ]))
        }
        const body = emitScopedBody(ctx, stmt.statement, indent + '\t')
        lines.push(...(body.length ? body : [`${indent}\tpass`]))
      }
      return lines
    } finally {
      ctx.switchContStack.pop()
      popBlockScope(ctx)
    }
  }
  if (ts.isWhileStatement(stmt)) {
    ctx.switchContStack.push(null)
    try {
      const lines = [`${indent}while true:`]
      lines.push(...withHoist(ctx, indent + '\t', () => [
        `${indent}\tif not RT.truthy(${emitExpr(ctx, stmt.expression, indent + '\t')}):`,
        `${indent}\t\tbreak`
      ]))
      const body = emitScopedBody(ctx, stmt.statement, indent + '\t')
      lines.push(...(body.length ? body : [`${indent}\tpass`]))
      return lines
    } finally {
      ctx.switchContStack.pop()
    }
  }
  if (ts.isDoStatement(stmt)) {
    ctx.switchContStack.push(null)
    try {
      const firstFlag = nextTemp(ctx, '_df')
      const lines = [
        `${indent}var ${firstFlag} := true`,
        `${indent}while true:`,
        `${indent}\tif ${firstFlag}:`,
        `${indent}\t\t${firstFlag} = false`,
        `${indent}\telse:`,
        ...withHoist(ctx, indent + '\t\t', () => [
          `${indent}\t\tif not RT.truthy(${emitExpr(ctx, stmt.expression, indent + '\t\t')}):`,
          `${indent}\t\t\tbreak`
        ])
      ]
      const body = emitScopedBody(ctx, stmt.statement, indent + '\t')
      lines.push(...(body.length ? body : [`${indent}\tpass`]))
      return lines
    } finally {
      ctx.switchContStack.pop()
    }
  }
  if (ts.isBlock(stmt)) {
    return emitScopedBody(ctx, stmt, indent)
  }
  if (ts.isTryStatement(stmt)) {
    const out = emitScopedBody(ctx, stmt.tryBlock, indent)
    if (stmt.finallyBlock) out.push(...emitScopedBody(ctx, stmt.finallyBlock, indent))
    return out
  }
  if (ts.isExpressionStatement(stmt)) {
    return withHoist(ctx, indent, () => emitExprStmt(ctx, stmt.expression, indent))
  }
  return []
}

/** Emit a full Godot 4 GDScript module from a parsed TypeScript SourceFile and its ModuleAnalysis. */
export function emitModuleGd(
  sf: ts.SourceFile,
  fileName: string,
  rtResPath: string,
  analysis: ModuleAnalysis
): string {
  const ctx = createEmitContext(analysis)

  const lines: string[] = [
    'extends RefCounted',
    `# Compiled from ${fileName} by Ridgetop TS -> GDScript 4 compiler.`,
    `const RT = preload(${gdString(rtResPath)})`,
    ''
  ]

  for (const name of ctx.topVars) {
    lines.push(`var ${safeIdent(name)}`)
  }
  if (ctx.topVars.size) lines.push('')

  // Module initializer loads imports and runs top-level variable initializers in source order.
  pushFuncScope(ctx)
  const initBody: string[] = []
  for (const [local, ref] of ctx.importedBindings) {
    initBody.push(`\t${safeIdent(local)} = RT.get_prop(RT.mod(${gdString(ref.resPath)}), ${gdString(safeIdent(ref.exportName))})`)
  }
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) continue
    initBody.push(...emitStmt(ctx, stmt, '\t', true))
  }
  for (const { local, alias } of ctx.exportAliases) {
    const rhs = ctx.topFuncs.has(local) ? `Callable(self, ${gdString(safeIdent(local))})` : safeIdent(local)
    initBody.push(`\t${safeIdent(alias)} = ${rhs}`)
  }
  popFuncScope(ctx)
  lines.push('func __init_module() -> void:')
  lines.push(...(initBody.length ? initBody : ['\tpass']))
  lines.push('')

  // Top-level functions become real GDScript methods on the module instance.
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue
    pushFuncScope(ctx)
    const fnName = safeIdent(stmt.name.text)
    const { sig, prelude } = emitParams(ctx, stmt.parameters, '\t')
    const body = emitBlockStatements(ctx, stmt.body.statements, '\t')
    popFuncScope(ctx)
    lines.push(`func ${fnName}(${sig}):`)
    const all = [...prelude, ...body]
    lines.push(...(all.length ? all : ['\tpass']))
    lines.push('')
  }

  return lines.join('\n')
}
