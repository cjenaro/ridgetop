import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
import { isMain } from '../framework/server.ts'

const GD_KEYWORDS = new Set([
  'if', 'elif', 'else', 'for', 'while', 'match', 'when', 'break', 'continue', 'pass', 'return',
  'class', 'class_name', 'extends', 'is', 'in', 'as', 'self', 'super', 'signal', 'func',
  'static', 'const', 'enum', 'var', 'breakpoint', 'preload', 'await', 'yield', 'assert',
  'void', 'PI', 'TAU', 'INF', 'NAN', 'and', 'or', 'not', 'true', 'false', 'null',
  // Common Godot built-in functions/types that collide with JS variable names
  'str', 'int', 'float', 'bool', 'range', 'load', 'print', 'len', 'min', 'max', 'abs', 'sign',
  'round', 'floor', 'ceil', 'clamp', 'lerp', 'sqrt', 'sin', 'cos', 'tan', 'atan2', 'exp', 'pow',
  'Vector2', 'Vector3', 'Color', 'Array', 'Dictionary', 'String', 'Node', 'Object', 'Resource'
])

function safeIdent(name: string) {
  return GD_KEYWORDS.has(name) ? '_v_' + name : name
}

function gdString(value: string) {
  return JSON.stringify(value)
}

/** Tiny Godot 4 runtime helper providing exact JS semantics for compiled Ridgetop TypeScript modules. */
export function renderRtGd(): string {
  return `extends RefCounted

# Ridgetop TypeScript -> GDScript 4 Runtime Support (RT)
# Provides exact JS semantics for compiled TypeScript modules (truthiness, float modulo,
# array higher-order methods, dict/array spread, and singleton ES module loading).

static var _modules: Dictionary = {}

static func mod(res_path: String) -> Object:
\tif _modules.has(res_path):
\t\treturn _modules[res_path]
\tvar script = load(res_path)
\tassert(script != null, "Failed to load compiled Ridgetop module: " + res_path)
\tvar instance = script.new()
\t_modules[res_path] = instance
\tif instance.has_method("__init_module"):
\t\tinstance.__init_module()
\treturn instance

static func clear_modules() -> void:
\t_modules.clear()

static func truthy(v: Variant) -> bool:
\tif v == null:
\t\treturn false
\tvar t := typeof(v)
\tif t == TYPE_BOOL:
\t\treturn v
\tif t == TYPE_INT:
\t\treturn v != 0
\tif t == TYPE_FLOAT:
\t\treturn v != 0.0 and not is_nan(v)
\tif t == TYPE_STRING:
\t\treturn (v as String).length() > 0
\t# Arrays, Dictionaries, Objects, and Callables are always truthy in JavaScript!
\treturn true

static func num(v: Variant) -> float:
\tif v == null:
\t\treturn 0.0
\tvar t := typeof(v)
\tif t == TYPE_BOOL:
\t\treturn 1.0 if v else 0.0
\tif t == TYPE_INT or t == TYPE_FLOAT:
\t\treturn float(v)
\tif t == TYPE_STRING:
\t\tvar s := (v as String).strip_edges()
\t\treturn float(s) if s.is_valid_float() else NAN
\treturn NAN

static func add(a: Variant, b: Variant) -> Variant:
\tif typeof(a) == TYPE_STRING or typeof(b) == TYPE_STRING:
\t\treturn str(a) + str(b)
\treturn num(a) + num(b)

static func eq(a: Variant, b: Variant) -> bool:
\tif a == null and b == null:
\t\treturn true
\tif a == null or b == null:
\t\treturn false
\tvar ta := typeof(a)
\tvar tb := typeof(b)
\tif (ta == TYPE_INT or ta == TYPE_FLOAT) and (tb == TYPE_INT or tb == TYPE_FLOAT):
\t\treturn float(a) == float(b)
\tif ta != tb:
\t\treturn false
\treturn a == b

static func rem(a: Variant, b: Variant) -> float:
\treturn fmod(float(a), float(b))

static func is_int(v: Variant) -> bool:
\tvar f := num(v)
\treturn is_finite(f) and floor(f) == f

static func hypot(args: Array) -> float:
\tvar sum := 0.0
\tfor a in args:
\t\tvar f := float(a)
\t\tsum += f * f
\treturn sqrt(sum)

static func max_all(args: Array) -> float:
\tvar best := -INF
\tfor a in args:
\t\tvar f := float(a)
\t\tif is_nan(f):
\t\t\treturn NAN
\t\tif f > best:
\t\t\tbest = f
\treturn best

static func min_all(args: Array) -> float:
\tvar best := INF
\tfor a in args:
\t\tvar f := float(a)
\t\tif is_nan(f):
\t\t\treturn NAN
\t\tif f < best:
\t\t\tbest = f
\treturn best

static func len_of(v: Variant) -> int:
\tif v == null:
\t\treturn 0
\tif v is Array:
\t\treturn (v as Array).size()
\tif v is Dictionary:
\t\tvar d := v as Dictionary
\t\tif d.has("__store"):
\t\t\treturn (d["__store"] as Dictionary).size()
\t\treturn d.size()
\tif v is String:
\t\treturn (v as String).length()
\treturn 0

static func type_of(v: Variant) -> String:
\tif v == null:
\t\treturn "undefined"
\tvar t := typeof(v)
\tif t == TYPE_BOOL:
\t\treturn "boolean"
\tif t == TYPE_INT or t == TYPE_FLOAT:
\t\treturn "number"
\tif t == TYPE_STRING:
\t\treturn "string"
\tif t == TYPE_CALLABLE:
\t\treturn "function"
\treturn "object"

static func iter(v: Variant) -> Variant:
\tif v == null:
\t\treturn []
\tif v is Dictionary:
\t\tvar d := v as Dictionary
\t\tif d.has("__is_set"):
\t\t\treturn (d["__store"] as Dictionary).keys()
\t\tif d.has("__is_map"):
\t\t\treturn obj_entries(d["__store"] as Dictionary)
\treturn v

static func get_prop(obj: Variant, key: Variant) -> Variant:
\tif obj == null:
\t\treturn null
\tif obj is Dictionary:
\t\tvar v: Variant = (obj as Dictionary).get(key, null)
\t\tif v is Dictionary and (v as Dictionary).has("__rt_getter"):
\t\t\treturn ((v as Dictionary)["__rt_getter"] as Callable).call()
\t\treturn v
\tif obj is Array:
\t\tvar idx := int(key)
\t\tvar arr := obj as Array
\t\treturn arr[idx] if idx >= 0 and idx < arr.size() else null
\tif obj is Object:
\t\tvar s := str(key)
\t\tif s in obj:
\t\t\treturn obj.get(s)
\t\tif obj.has_method(s):
\t\t\treturn Callable(obj, s)
\treturn null

static func set_prop(obj: Variant, key: Variant, value: Variant) -> Variant:
\tif obj is Dictionary:
\t\t(obj as Dictionary)[key] = value
\telif obj is Array:
\t\t(obj as Array)[int(key)] = value
\telif obj is Object:
\t\tobj.set(str(key), value)
\treturn value

static func invoke(callee: Variant, args: Array) -> Variant:
\tif callee is Callable:
\t\tvar fn := callee as Callable
\t\tvar argc := fn.get_argument_count()
\t\tif argc >= 0 and args.size() > argc:
\t\t\treturn fn.callv(args.slice(0, argc))
\t\treturn fn.callv(args)
\tpush_error("Attempted to call non-callable value: " + str(callee))
\treturn null

static func invoke_opt(callee: Variant, args: Array) -> Variant:
\tif callee == null:
\t\treturn null
\treturn invoke(callee, args)

static func _call_cb(cb: Callable, item: Variant, index: int, arr: Array) -> Variant:
\tvar argc := cb.get_argument_count()
\tif argc <= 0:
\t\treturn cb.call()
\tif argc == 1:
\t\treturn cb.call(item)
\tif argc == 2:
\t\treturn cb.call(item, index)
\treturn cb.call(item, index, arr)

static func map(arr: Array, cb: Callable) -> Array:
\tvar out: Array = []
\tfor i in range(arr.size()):
\t\tout.append(_call_cb(cb, arr[i], i, arr))
\treturn out

static func filter(arr: Array, cb: Callable) -> Array:
\tvar out: Array = []
\tfor i in range(arr.size()):
\t\tif truthy(_call_cb(cb, arr[i], i, arr)):
\t\t\tout.append(arr[i])
\treturn out

static func some(arr: Array, cb: Callable) -> bool:
\tfor i in range(arr.size()):
\t\tif truthy(_call_cb(cb, arr[i], i, arr)):
\t\t\treturn true
\treturn false

static func every(arr: Array, cb: Callable) -> bool:
\tfor i in range(arr.size()):
\t\tif not truthy(_call_cb(cb, arr[i], i, arr)):
\t\t\treturn false
\treturn true

static func find(arr: Array, cb: Callable) -> Variant:
\tfor i in range(arr.size()):
\t\tif truthy(_call_cb(cb, arr[i], i, arr)):
\t\t\treturn arr[i]
\treturn null

static func find_index(arr: Array, cb: Callable) -> int:
\tfor i in range(arr.size()):
\t\tif truthy(_call_cb(cb, arr[i], i, arr)):
\t\t\treturn i
\treturn -1

static func for_each(arr: Array, cb: Callable) -> void:
\tfor i in range(arr.size()):
\t\t_call_cb(cb, arr[i], i, arr)

static func reduce(arr: Array, cb: Callable, has_init: bool, init: Variant = null) -> Variant:
\tvar acc: Variant = init if has_init else arr[0]
\tvar start := 0 if has_init else 1
\tfor i in range(start, arr.size()):
\t\tacc = cb.call(acc, arr[i])
\treturn acc

static func slice(arr: Variant, start: int = 0, end_idx: Variant = null) -> Variant:
\tif arr is Array:
\t\tvar a := arr as Array
\t\tvar n := a.size()
\t\tvar s := maxi(0, n + start if start < 0 else start)
\t\tvar e := n if end_idx == null else maxi(0, n + int(end_idx) if int(end_idx) < 0 else mini(n, int(end_idx)))
\t\treturn a.slice(s, e)
\tif arr is String:
\t\tvar st := arr as String
\t\tvar n := st.length()
\t\tvar s := maxi(0, n + start if start < 0 else start)
\t\tvar e := n if end_idx == null else maxi(0, n + int(end_idx) if int(end_idx) < 0 else mini(n, int(end_idx)))
\t\treturn st.substr(s, maxi(0, e - s))
\treturn []

static func at(arr: Array, idx: int) -> Variant:
\tvar i := arr.size() + idx if idx < 0 else idx
\treturn arr[i] if i >= 0 and i < arr.size() else null

static func entries(arr: Array) -> Array:
\tvar out: Array = []
\tfor i in range(arr.size()):
\t\tout.append([i, arr[i]])
\treturn out

static func includes(container: Variant, value: Variant) -> bool:
\tif container is Array:
\t\tfor item in container:
\t\t\tif eq(item, value):
\t\t\t\treturn true
\t\treturn false
\tif container is String:
\t\treturn (container as String).contains(str(value))
\treturn false

static func sort_arr(arr: Array, cmp: Variant = null) -> Array:
\tif cmp is Callable:
\t\tvar fn := cmp as Callable
\t\tarr.sort_custom(func(a, b): return num(fn.call(a, b)) < 0.0)
\telse:
\t\tarr.sort()
\treturn arr

static func spread_dict(parts: Array) -> Dictionary:
\tvar out: Dictionary = {}
\tfor part in parts:
\t\tif part is Dictionary:
\t\t\tfor k in (part as Dictionary).keys():
\t\t\t\tout[k] = part[k]
\treturn out

static func spread_arr(parts: Array) -> Array:
\tvar out: Array = []
\tfor part in parts:
\t\tif part is Array:
\t\t\tfor item in part:
\t\t\t\tout.append(item)
\t\telse:
\t\t\tout.append(part)
\treturn out

static func assign(target: Dictionary, sources: Array) -> Dictionary:
\tfor src in sources:
\t\tif src is Dictionary:
\t\t\tfor k in (src as Dictionary).keys():
\t\t\t\ttarget[k] = src[k]
\treturn target

static func obj_entries(d: Dictionary) -> Array:
\tvar out: Array = []
\tfor k in d.keys():
\t\tout.append([k, d[k]])
\treturn out

static func from_entries(pairs: Array) -> Dictionary:
\tvar out: Dictionary = {}
\tfor p in pairs:
\t\tout[p[0]] = p[1]
\treturn out

static func push_many(arr: Array, items: Array) -> int:
\tarr.append_array(items)
\treturn arr.size()

static func typed_array(arg: Variant = 0) -> Array:
\tif arg is Array:
\t\treturn (arg as Array).duplicate()
\tvar n := int(arg)
\tvar out: Array = []
\tout.resize(maxi(0, n))
\tout.fill(0.0)
\treturn out

static func json_parse(s: Variant) -> Variant:
\tif s == null:
\t\treturn null
\treturn JSON.parse_string(str(s))

static func arr_from(iterable: Variant, mapper: Variant = null) -> Array:
\tvar out: Array = []
\tif iterable is Array:
\t\tout = (iterable as Array).duplicate()
\telif iterable is Dictionary:
\t\tvar d := iterable as Dictionary
\t\tif d.has("__is_set"):
\t\t\tout = (d["__store"] as Dictionary).keys()
\t\telif d.has("__is_map"):
\t\t\tout = obj_entries(d["__store"] as Dictionary)
\t\telse:
\t\t\tfor k in d.keys():
\t\t\t\tout.append(k)
\telif iterable is String:
\t\tvar s := iterable as String
\t\tfor i in range(s.length()):
\t\t\tout.append(s.substr(i, 1))
\tif mapper is Callable:
\t\treturn map(out, mapper as Callable)
\treturn out

static func make_map() -> Dictionary:
\tvar store: Dictionary = {}
\tvar map_obj: Dictionary = {}
\tvar fn_set := func(k, v):
\t\tstore[k] = v
\t\treturn map_obj
\tmap_obj["__is_map"] = true
\tmap_obj["__store"] = store
\tmap_obj["get"] = func(k): return store.get(k, null)
\tmap_obj["set"] = fn_set
\tmap_obj["has"] = func(k): return store.has(k)
\tmap_obj["delete"] = func(k): return store.erase(k)
\tmap_obj["clear"] = func(): store.clear()
\tmap_obj["keys"] = func(): return store.keys()
\tmap_obj["values"] = func(): return store.values()
\tmap_obj["entries"] = func(): return obj_entries(store)
\treturn map_obj

static func make_set() -> Dictionary:
\tvar store: Dictionary = {}
\tvar set_obj: Dictionary = {}
\tvar fn_add := func(v):
\t\tstore[v] = true
\t\treturn set_obj
\tset_obj["__is_set"] = true
\tset_obj["__store"] = store
\tset_obj["add"] = fn_add
\tset_obj["has"] = func(v): return store.has(v)
\tset_obj["delete"] = func(v): return store.erase(v)
\tset_obj["clear"] = func(): store.clear()
\tset_obj["values"] = func(): return store.keys()
\treturn set_obj
`
}

interface CompileFileOptions {
  /** Absolute or project-relative path to `rt.gd` in Godot `res://` format. */
  rtResPath?: string
  /** Resolve an imported specifier + symbol name to a Godot `res://...gd` path. */
  resolveImport?(specifier: string, exportedName: string): { resPath: string; exportName: string }
}

/** Collect variable names that are mutated inside any nested function/arrow (need 1-element box in GDScript). */
function findBoxedVars(root: ts.Node): Set<string> {
  const boxed = new Set<string>()
  const scopes: Set<string>[] = []

  function declare(name: ts.BindingName) {
    const top = scopes[scopes.length - 1]
    if (!top) return
    if (ts.isIdentifier(name)) top.add(name.text)
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) declare(el.name)
      }
    }
  }

  function markMutation(name: string) {
    // If mutated in an inner function (not declared in the innermost function scope), box it!
    const current = scopes[scopes.length - 1]
    if (current && !current.has(name)) {
      for (let i = scopes.length - 2; i >= 1; i--) {
        if (scopes[i].has(name)) {
          boxed.add(name)
          return
        }
      }
    }
  }

  function visit(node: ts.Node, isFunctionBoundary = false) {
    if (isFunctionBoundary) {
      scopes.push(new Set())
      if (ts.isFunctionLike(node)) {
        for (const p of node.parameters) declare(p.name)
      }
    } else if (ts.isVariableDeclaration(node)) {
      declare(node.name)
    } else if (ts.isBinaryExpression(node) && isAssignmentOp(node.operatorToken.kind)) {
      if (ts.isIdentifier(node.left)) markMutation(node.left.text)
    } else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) {
      if (ts.isIdentifier(node.operand)) markMutation(node.operand.text)
    }

    ts.forEachChild(node, child => {
      const nextBoundary = ts.isFunctionDeclaration(child) || ts.isFunctionExpression(child) ||
        ts.isArrowFunction(child) || ts.isMethodDeclaration(child)
      visit(child, nextBoundary)
    })

    if (isFunctionBoundary) scopes.pop()
  }

  scopes.push(new Set())
  visit(root, false)
  scopes.pop()
  return boxed
}

function isAssignmentOp(kind: ts.SyntaxKind) {
  return kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.PlusEqualsToken ||
    kind === ts.SyntaxKind.MinusEqualsToken ||
    kind === ts.SyntaxKind.AsteriskEqualsToken ||
    kind === ts.SyntaxKind.SlashEqualsToken ||
    kind === ts.SyntaxKind.PercentEqualsToken ||
    kind === ts.SyntaxKind.BarEqualsToken ||
    kind === ts.SyntaxKind.AmpersandEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken
}

/** Compile a TypeScript source file into idiomatic Godot 4 GDScript. */
export function compileTsToGd(sourceText: string, fileName = 'module.ts', options: CompileFileOptions = {}): string {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
  const rtResPath = options.rtResPath ?? 'res://scripts/compiled/rt.gd'
  const boxedVars = findBoxedVars(sf)

  // Track top-level `func` declarations and module-level variables so calls & value refs emit cleanly.
  const topFuncs = new Set<string>()
  const topVars = new Set<string>()
  const importedBindings = new Map<string, { resPath: string; exportName: string }>()
  let tempCounter = 0
  const nextTemp = (prefix = '_t') => `${prefix}${++tempCounter}`

  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      topFuncs.add(stmt.name.text)
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) collectBindingNames(decl.name, topVars)
    } else if (ts.isImportDeclaration(stmt)) {
      if (stmt.importClause?.isTypeOnly) continue
      const specifier = (stmt.moduleSpecifier as ts.StringLiteral).text
      const bindings = stmt.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue
          const imported = (el.propertyName ?? el.name).text
          const local = el.name.text
          const resolved = options.resolveImport
            ? options.resolveImport(specifier, imported)
            : { resPath: specifier.replace(/\.ts$/, '.gd'), exportName: imported }
          importedBindings.set(local, resolved)
          topVars.add(local)
        }
      }
    }
  }

  function collectBindingNames(name: ts.BindingName, out: Set<string>) {
    if (ts.isIdentifier(name)) out.add(name.text)
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) collectBindingNames(el.name, out)
      }
    }
  }

  const scopeStack: Map<string, string>[] = []
  const funcUsedStack: Set<string>[] = []
  const hoistStack: { indent: string; lines: string[] }[] = []

  function pushFuncScope(isNested = false) {
    scopeStack.push(new Map())
    const parentUsed = isNested && funcUsedStack.length ? funcUsedStack[funcUsedStack.length - 1] : null
    const base = parentUsed ? new Set(parentUsed) : new Set([...topVars, ...topFuncs].map(safeIdent))
    funcUsedStack.push(base)
  }

  function popFuncScope() {
    scopeStack.pop()
    funcUsedStack.pop()
  }

  function pushBlockScope() {
    scopeStack.push(new Map())
  }

  function popBlockScope() {
    scopeStack.pop()
  }

  function withHoist(indent: string, fn: () => string[]): string[] {
    const frame = { indent, lines: [] as string[] }
    hoistStack.push(frame)
    try {
      const emitted = fn()
      return [...frame.lines, ...emitted]
    } finally {
      hoistStack.pop()
    }
  }

  function declareLocal(raw: string): string {
    const base = safeIdent(raw)
    const used = funcUsedStack[funcUsedStack.length - 1]
    if (!used) return base
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) {
      candidate = `${base}_${suffix++}`
    }
    used.add(candidate)
    const topScope = scopeStack[scopeStack.length - 1]
    if (topScope) topScope.set(raw, candidate)
    return candidate
  }

  function resolveLocal(raw: string): { id: string; isLocal: boolean } {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const hit = scopeStack[i].get(raw)
      if (hit) return { id: hit, isLocal: true }
    }
    return { id: safeIdent(raw), isLocal: false }
  }

  function varRef(name: string) {
    const { id, isLocal } = resolveLocal(name)
    return isLocal && boxedVars.has(name) ? `${id}[0]` : id
  }

  function formatList(open: string, items: string[], close: string, _indent: string, spacePad = false): string {
    if (!items.length) return `${open}${close}`
    return spacePad ? `${open} ${items.join(', ')} ${close}` : `${open}${items.join(', ')}${close}`
  }

  function emitBindingDecls(name: ts.BindingName, rhsExpr: string, indent: string, isModuleTop: boolean): string[] {
    const lines: string[] = []
    if (ts.isIdentifier(name)) {
      const raw = name.text
      const id = isModuleTop ? safeIdent(raw) : declareLocal(raw)
      const val = !isModuleTop && boxedVars.has(raw) ? `[${rhsExpr}]` : rhsExpr
      lines.push(isModuleTop ? `${indent}${id} = ${val}` : `${indent}var ${id} = ${val}`)
      return lines
    }
    const tmp = nextTemp('_d')
    lines.push(`${indent}var ${tmp} = ${rhsExpr}`)
    if (ts.isObjectBindingPattern(name)) {
      for (const el of name.elements) {
        if (!ts.isBindingElement(el)) continue
        const keyExpr = el.propertyName
          ? propKeyExpr(el.propertyName, indent)
          : gdString(ts.isIdentifier(el.name) ? el.name.text : '')
        let access = `RT.get_prop(${tmp}, ${keyExpr})`
        if (el.initializer) {
          const defExpr = emitExpr(el.initializer, indent)
          const checkTmp = nextTemp('_opt')
          lines.push(`${indent}var ${checkTmp} = ${access}`)
          access = `(${defExpr} if ${checkTmp} == null else ${checkTmp})`
        }
        lines.push(...emitBindingDecls(el.name, access, indent, isModuleTop))
      }
    } else if (ts.isArrayBindingPattern(name)) {
      for (const [idx, el] of name.elements.entries()) {
        if (ts.isOmittedExpression(el)) continue
        let access = `RT.get_prop(${tmp}, ${idx})`
        if (el.initializer) {
          const defExpr = emitExpr(el.initializer, indent)
          const checkTmp = nextTemp('_opt')
          lines.push(`${indent}var ${checkTmp} = ${access}`)
          access = `(${defExpr} if ${checkTmp} == null else ${checkTmp})`
        }
        lines.push(...emitBindingDecls(el.name, access, indent, isModuleTop))
      }
    }
    return lines
  }

  function emitParams(params: readonly ts.ParameterDeclaration[], bodyIndent: string): { sig: string; prelude: string[] } {
    const sigParts: string[] = []
    const prelude: string[] = []
    for (const p of params) {
      const isOptional = Boolean(p.initializer || p.questionToken)
      if (ts.isIdentifier(p.name) && !boxedVars.has(p.name.text)) {
        const id = declareLocal(p.name.text)
        if (p.initializer) {
          const tmp = nextTemp('_p')
          sigParts.push(`${tmp} = null`)
          const defVal = emitExpr(p.initializer, bodyIndent)
          prelude.push(`${bodyIndent}var ${id} = ${defVal} if ${tmp} == null else ${tmp}`)
        } else {
          sigParts.push(`${id} = null`)
        }
      } else {
        const tmp = nextTemp('_p')
        sigParts.push(`${tmp} = null`)
        let src = tmp
        if (p.initializer) {
          const defVal = emitExpr(p.initializer, bodyIndent)
          const norm = nextTemp('_pn')
          prelude.push(`${bodyIndent}var ${norm} = ${defVal} if ${tmp} == null else ${tmp}`)
          src = norm
        }
        prelude.push(...emitBindingDecls(p.name, src, bodyIndent, false))
      }
    }
    return { sig: sigParts.join(', '), prelude }
  }

  function unwrapTs(expr: ts.Expression): ts.Expression {
    while (ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isNonNullExpression(expr) || ts.isTypeAssertionExpression(expr)) {
      expr = expr.expression
    }
    return expr
  }

  function emitExpr(raw: ts.Expression, indent: string, isCallee = false): string {
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
        parts.push(`str(${emitExpr(span.expression, indent)})`)
        if (span.literal.text) parts.push(gdString(span.literal.text))
      }
      return parts.length ? `(${parts.join(' + ')})` : '""'
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true'
    if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false'
    if (node.kind === ts.SyntaxKind.NullKeyword) return 'null'
    if (ts.isIdentifier(node)) {
      if (node.text === 'undefined') return 'null'
      if (node.text === 'Infinity') return 'INF'
      if (node.text === 'NaN') return 'NAN'
      const local = resolveLocal(node.text)
      if (!local.isLocal && !isCallee && topFuncs.has(node.text)) {
        return `Callable(self, ${gdString(safeIdent(node.text))})`
      }
      return varRef(node.text)
    }
    if (ts.isParenthesizedExpression(node)) {
      return `(${emitExpr(node.expression, indent)})`
    }
    if (ts.isTypeOfExpression(node)) {
      return `RT.type_of(${emitExpr(node.expression, indent)})`
    }
    if (ts.isArrayLiteralExpression(node)) {
      const itemIndent = indent + '\t'
      const hasSpread = node.elements.some(el => ts.isSpreadElement(el))
      if (!hasSpread) {
        const items = node.elements.map(el => emitExpr(el, itemIndent))
        return formatList('[', items, ']', indent)
      }
      const parts = node.elements.map(el => ts.isSpreadElement(el) ? emitExpr(el.expression, itemIndent) : `[${emitExpr(el, itemIndent)}]`)
      return `RT.spread_arr(${formatList('[', parts, ']', indent)})`
    }
    if (ts.isObjectLiteralExpression(node)) {
      const itemIndent = indent + '\t'
      const hasSpread = node.properties.some(p => ts.isSpreadAssignment(p))
      if (!hasSpread) {
        const pairs: string[] = []
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const key = propKeyExpr(prop.name, itemIndent)
            pairs.push(`${key}: ${emitExpr(prop.initializer, itemIndent)}`)
          } else if (ts.isShorthandPropertyAssignment(prop)) {
            pairs.push(`${gdString(prop.name.text)}: ${varRef(prop.name.text)}`)
          } else if (ts.isMethodDeclaration(prop)) {
            const key = propKeyExpr(prop.name, itemIndent)
            pairs.push(`${key}: ${emitLambda(prop.parameters, prop.body, itemIndent)}`)
          } else if (ts.isGetAccessorDeclaration(prop)) {
            const key = propKeyExpr(prop.name, itemIndent)
            pairs.push(`${key}: { "__rt_getter": ${emitLambda([], prop.body, itemIndent + '\t')} }`)
          }
        }
        return formatList('{', pairs, '}', indent, true)
      }
      const chunks: string[] = []
      let currentPairs: string[] = []
      const flush = () => {
        if (currentPairs.length) {
          chunks.push(formatList('{', currentPairs, '}', itemIndent, true))
          currentPairs = []
        }
      }
      for (const prop of node.properties) {
        if (ts.isSpreadAssignment(prop)) {
          flush()
          chunks.push(emitExpr(prop.expression, itemIndent))
        } else if (ts.isPropertyAssignment(prop)) {
          currentPairs.push(`${propKeyExpr(prop.name, itemIndent)}: ${emitExpr(prop.initializer, itemIndent)}`)
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          currentPairs.push(`${gdString(prop.name.text)}: ${varRef(prop.name.text)}`)
        } else if (ts.isMethodDeclaration(prop)) {
          currentPairs.push(`${propKeyExpr(prop.name, itemIndent)}: ${emitLambda(prop.parameters, prop.body, itemIndent)}`)
        }
      }
      flush()
      return `RT.spread_dict(${formatList('[', chunks, ']', indent)})`
    }
    if (ts.isPrefixUnaryExpression(node)) {
      const op = node.operator
      const inner = emitExpr(node.operand, indent)
      if (op === ts.SyntaxKind.ExclamationToken) return `(not RT.truthy(${inner}))`
      if (op === ts.SyntaxKind.MinusToken) return `(-(${inner}))`
      if (op === ts.SyntaxKind.PlusToken) return `RT.num(${inner})`
      if (op === ts.SyntaxKind.TildeToken) return `(~int(${inner}))`
      if (op === ts.SyntaxKind.PlusPlusToken) return `(${inner} + 1)`
      if (op === ts.SyntaxKind.MinusMinusToken) return `(${inner} - 1)`
    }
    if (ts.isPostfixUnaryExpression(node)) {
      return emitExpr(node.operand, indent)
    }
    if (ts.isConditionalExpression(node)) {
      return `((${emitExpr(node.whenTrue, indent)}) if RT.truthy(${emitExpr(node.condition, indent)}) else (${emitExpr(node.whenFalse, indent)}))`
    }
    if (ts.isPropertyAccessExpression(node)) {
      const prop = node.name.text
      const target = unwrapTs(node.expression)
      if (ts.isIdentifier(target) && target.text === 'Math' && prop === 'PI') return 'PI'
      if (prop === 'length' || prop === 'size') return `RT.len_of(${emitExpr(target, indent)})`
      return `RT.get_prop(${emitExpr(target, indent)}, ${gdString(prop)})`
    }
    if (ts.isElementAccessExpression(node)) {
      return `RT.get_prop(${emitExpr(node.expression, indent)}, ${emitExpr(node.argumentExpression, indent)})`
    }
    if (ts.isBinaryExpression(node)) {
      return emitBinary(node, indent)
    }
    if (ts.isCallExpression(node)) {
      return emitCall(node, indent)
    }
    if (ts.isNewExpression(node)) {
      const target = unwrapTs(node.expression)
      if (ts.isIdentifier(target)) {
        if (target.text === 'Map' || target.text === 'WeakMap') return 'RT.make_map()'
        if (target.text === 'Set') return 'RT.make_set()'
        if (target.text === 'Float32Array' || target.text === 'Float64Array' || target.text === 'Int32Array' || target.text === 'Uint16Array' || target.text === 'Uint32Array' || target.text === 'Uint8Array') {
          const arg = node.arguments?.[0] ? emitExpr(node.arguments[0], indent) : '0'
          return `RT.typed_array(${arg})`
        }
        if (target.text === 'RangeError' || target.text === 'Error' || target.text === 'TypeError') {
          const msg = node.arguments?.[0] ? emitExpr(node.arguments[0], indent) : '""'
          return `str(${msg})`
        }
      }
      return 'null'
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      return emitLambda(node.parameters, node.body, indent)
    }
    return 'null'
  }

  function propKeyExpr(name: ts.PropertyName, indent: string): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return gdString(name.text)
    if (ts.isComputedPropertyName(name)) return emitExpr(name.expression, indent)
    return '""'
  }

  function emitBinary(node: ts.BinaryExpression, indent: string): string {
    const op = node.operatorToken.kind
    const L = emitExpr(node.left, indent)
    const R = emitExpr(node.right, indent)

    if (op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.EqualsEqualsToken) return `RT.eq(${L}, ${R})`
    if (op === ts.SyntaxKind.ExclamationEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken) return `(not RT.eq(${L}, ${R}))`
    if (op === ts.SyntaxKind.PlusToken) return `RT.add(${L}, ${R})`
    if (op === ts.SyntaxKind.MinusToken) return `(${L} - ${R})`
    if (op === ts.SyntaxKind.AsteriskToken) return `(${L} * ${R})`
    if (op === ts.SyntaxKind.SlashToken) return `(float(${L}) / float(${R}))`
    if (op === ts.SyntaxKind.PercentToken) return `RT.rem(${L}, ${R})`
    if (op === ts.SyntaxKind.AsteriskAsteriskToken) return `pow(float(${L}), float(${R}))`
    if (op === ts.SyntaxKind.LessThanToken) return `(${L} < ${R})`
    if (op === ts.SyntaxKind.LessThanEqualsToken) return `(${L} <= ${R})`
    if (op === ts.SyntaxKind.GreaterThanToken) return `(${L} > ${R})`
    if (op === ts.SyntaxKind.GreaterThanEqualsToken) return `(${L} >= ${R})`
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return `((${R}) if RT.truthy(${L}) else (${L}))`
    if (op === ts.SyntaxKind.BarBarToken) return `((${L}) if RT.truthy(${L}) else (${R}))`
    if (op === ts.SyntaxKind.QuestionQuestionToken) return `((${R}) if (${L}) == null else (${L}))`
    if (op === ts.SyntaxKind.AmpersandToken) return `(int(${L}) & int(${R}))`
    if (op === ts.SyntaxKind.BarToken) return `(int(${L}) | int(${R}))`
    if (op === ts.SyntaxKind.CaretToken) return `(int(${L}) ^ int(${R}))`
    if (op === ts.SyntaxKind.LessThanLessThanToken) return `(int(${L}) << int(${R}))`
    if (op === ts.SyntaxKind.GreaterThanGreaterThanToken) return `(int(${L}) >> int(${R}))`
    if (op === ts.SyntaxKind.InKeyword) return `(${R} is Dictionary and ${R}.has(${L}))`
    return `(${L})`
  }

  function emitCall(node: ts.CallExpression, indent: string): string {
    const callee = unwrapTs(node.expression)
    const argIndent = indent + '\t'
    const args = node.arguments.map(arg => emitExpr(arg, argIndent))
    const isOptionalCall = Boolean(
      node.questionDotToken ||
      (ts.isPropertyAccessExpression(callee) && callee.questionDotToken) ||
      (ts.isElementAccessExpression(callee) && callee.questionDotToken)
    )
    const invokeFn = isOptionalCall ? 'RT.invoke_opt' : 'RT.invoke'
    const argsArr = formatList('[', args, ']', indent)

    if (ts.isIdentifier(callee)) {
      if (callee.text === 'Number') return `RT.num(${args[0] ?? '0'})`
      if (callee.text === 'Boolean') return `RT.truthy(${args[0] ?? 'false'})`
      if (callee.text === 'String') return `str(${args[0] ?? '""'})`
      const local = resolveLocal(callee.text)
      if (!local.isLocal && topFuncs.has(callee.text)) {
        return `${safeIdent(callee.text)}${formatList('(', args, ')', indent)}`
      }
      return `${invokeFn}(${varRef(callee.text)}, ${argsArr})`
    }

    if (ts.isPropertyAccessExpression(callee)) {
      const objNode = unwrapTs(callee.expression)
      const method = callee.name.text
      const obj = emitExpr(objNode, indent)

      // Math.*
      if (ts.isIdentifier(objNode) && objNode.text === 'Math') {
        if (method === 'max') return args.length === 2 ? `maxf(float(${args[0]}), float(${args[1]}))` : `RT.max_all(${argsArr})`
        if (method === 'min') return args.length === 2 ? `minf(float(${args[0]}), float(${args[1]}))` : `RT.min_all(${argsArr})`
        if (method === 'abs') return `absf(float(${args[0]}))`
        if (method === 'floor') return `floor(float(${args[0]}))`
        if (method === 'ceil') return `ceil(float(${args[0]}))`
        if (method === 'round') return `round(float(${args[0]}))`
        if (method === 'sqrt') return `sqrt(float(${args[0]}))`
        if (method === 'sin') return `sin(float(${args[0]}))`
        if (method === 'cos') return `cos(float(${args[0]}))`
        if (method === 'tan') return `tan(float(${args[0]}))`
        if (method === 'atan2') return `atan2(float(${args[0]}), float(${args[1]}))`
        if (method === 'exp') return `exp(float(${args[0]}))`
        if (method === 'pow') return `pow(float(${args[0]}), float(${args[1]}))`
        if (method === 'sign') return `sign(float(${args[0]}))`
        if (method === 'hypot') return `RT.hypot(${argsArr})`
      }

      // Number.*
      if (ts.isIdentifier(objNode) && objNode.text === 'Number') {
        if (method === 'isFinite') return `is_finite(RT.num(${args[0]}))`
        if (method === 'isInteger' || method === 'isSafeInteger') return `RT.is_int(${args[0]})`
        if (method === 'isNaN') return `is_nan(RT.num(${args[0]}))`
      }

      // JSON.*
      if (ts.isIdentifier(objNode) && objNode.text === 'JSON') {
        if (method === 'parse') return `RT.json_parse(${args[0] ?? 'null'})`
        if (method === 'stringify') return `JSON.stringify(${args[0] ?? 'null'})`
      }

      // Object.*
      if (ts.isIdentifier(objNode) && objNode.text === 'Object') {
        if (method === 'freeze') return args[0] ?? '{}'
        if (method === 'assign') return `RT.assign(${args[0]}, ${formatList('[', args.slice(1), ']', indent)})`
        if (method === 'keys') return `(${args[0]}).keys()`
        if (method === 'values') return `(${args[0]}).values()`
        if (method === 'entries') return `RT.obj_entries(${args[0]})`
        if (method === 'fromEntries') return `RT.from_entries(${args[0]})`
        if (method === 'hasOwn') return `(${args[0]} is Dictionary and (${args[0]}).has(${args[1]}))`
      }

      // Array.*
      if (ts.isIdentifier(objNode) && objNode.text === 'Array') {
        if (method === 'isArray') return `(${args[0]} is Array)`
        if (method === 'from') return `RT.arr_from${formatList('(', [args[0], args[1] ?? 'null'], ')', indent)}`
      }

      // Built-in Array / String methods
      if (method === 'map') return `RT.map${formatList('(', [obj, args[0]], ')', indent)}`
      if (method === 'filter') return `RT.filter${formatList('(', [obj, args[0]], ')', indent)}`
      if (method === 'some') return `RT.some${formatList('(', [obj, args[0]], ')', indent)}`
      if (method === 'every') return `RT.every${formatList('(', [obj, args[0]], ')', indent)}`
      if (method === 'find') return `RT.find${formatList('(', [obj, args[0]], ')', indent)}`
      if (method === 'findIndex') return `RT.find_index${formatList('(', [obj, args[0]], ')', indent)}`
      if (method === 'forEach') return `RT.for_each${formatList('(', [obj, args[0]], ')', indent)}`
      if (method === 'reduce') return `RT.reduce${formatList('(', [obj, args[0], args.length > 1 ? 'true' : 'false', args[1] ?? 'null'], ')', indent)}`
      if (method === 'slice') return `RT.slice(${obj}, ${args[0] ?? '0'}, ${args[1] ?? 'null'})`
      if (method === 'at') return `RT.at(${obj}, int(${args[0]}))`
      if (method === 'entries') return `RT.entries(${obj})`
      if (method === 'includes') return `RT.includes(${obj}, ${args[0]})`
      if (method === 'indexOf') return `(${obj}).find(${args[0]})`
      if (method === 'push') return args.length <= 1 ? `(${obj}).append(${args[0] ?? 'null'})` : `RT.push_many(${obj}, [${args.join(', ')}])`
      if (method === 'pop') return `(${obj}).pop_back()`
      if (method === 'sort') return `RT.sort_arr${formatList('(', [obj, args[0] ?? 'null'], ')', indent)}`
      if (method === 'join') return `(${args[0] ?? '","'}).join(PackedStringArray(RT.map(${obj}, func(x): return str(x))))`
      if (method === 'toFixed') return `("%." + str(int(${args[0] ?? '0'})) + "f") % float(${obj})`

      // General method call on an object / dictionary / module
      return `${invokeFn}(RT.get_prop(${obj}, ${gdString(method)}), ${argsArr})`
    }

    return `${invokeFn}(${emitExpr(callee, indent)}, ${argsArr})`
  }

  function emitLambda(params: readonly ts.ParameterDeclaration[], body: ts.ConciseBody | undefined, _indent: string): string {
    const hoist = hoistStack[hoistStack.length - 1]
    const hostIndent = hoist ? hoist.indent : '\t'
    const innerIndent = hostIndent + '\t'
    pushFuncScope(true)
    try {
      const { sig, prelude } = emitParams(params, innerIndent)
      let bodyLines: string[]
      if (!body) {
        return `func(${sig}): return null`
      } else if (!ts.isBlock(body)) {
        const exprFrame = { indent: innerIndent, lines: [] as string[] }
        hoistStack.push(exprFrame)
        const exprText = emitExpr(body, innerIndent)
        hoistStack.pop()
        if (!prelude.length && !exprFrame.lines.length && !exprText.includes('\n')) {
          return `func(${sig}): return ${exprText}`
        }
        bodyLines = [...prelude, ...exprFrame.lines, `${innerIndent}return ${exprText}`]
      } else {
        const stmts = emitBlockStatements(body.statements, innerIndent)
        if (!prelude.length && !stmts.length) return `func(${sig}): pass`
        bodyLines = [...prelude, ...stmts]
      }
      const fnName = nextTemp('_fn')
      const def = `${hostIndent}var ${fnName} = func(${sig}):\n${bodyLines.join('\n')}`
      if (hoist) {
        hoist.lines.push(def)
        return fnName
      }
      return `func(${sig}):\n${bodyLines.join('\n')}`
    } finally {
      popFuncScope()
    }
  }

  function emitAssignStmt(node: ts.BinaryExpression, indent: string): string[] {
    const op = node.operatorToken.kind
    const rhs = ts.isBinaryExpression(node.right) && isAssignmentOp(node.right.operatorToken.kind)
      ? (() => {
          const inner = emitAssignStmt(node.right, indent)
          const leftExpr = emitExpr(node.right.left, indent)
          return { prefix: inner, value: leftExpr }
        })()
      : { prefix: [] as string[], value: emitExpr(node.right, indent) }

    const lines = [...rhs.prefix]
    const lhs = unwrapTs(node.left)
    const applyOp = (cur: string, val: string) => {
      if (op === ts.SyntaxKind.EqualsToken) return val
      if (op === ts.SyntaxKind.PlusEqualsToken) return `RT.add(${cur}, ${val})`
      if (op === ts.SyntaxKind.MinusEqualsToken) return `(${cur} - ${val})`
      if (op === ts.SyntaxKind.AsteriskEqualsToken) return `(${cur} * ${val})`
      if (op === ts.SyntaxKind.SlashEqualsToken) return `(float(${cur}) / float(${val}))`
      if (op === ts.SyntaxKind.PercentEqualsToken) return `RT.rem(${cur}, ${val})`
      if (op === ts.SyntaxKind.BarEqualsToken) return `(int(${cur}) | int(${val}))`
      if (op === ts.SyntaxKind.AmpersandEqualsToken) return `(int(${cur}) & int(${val}))`
      if (op === ts.SyntaxKind.QuestionQuestionEqualsToken) return `(${val} if (${cur}) == null else (${cur}))`
      return val
    }

    if (ts.isIdentifier(lhs)) {
      const target = varRef(lhs.text)
      lines.push(`${indent}${target} = ${applyOp(target, rhs.value)}`)
    } else if (ts.isPropertyAccessExpression(lhs)) {
      const obj = emitExpr(lhs.expression, indent)
      const key = gdString(lhs.name.text)
      const cur = `RT.get_prop(${obj}, ${key})`
      lines.push(`${indent}RT.set_prop(${obj}, ${key}, ${applyOp(cur, rhs.value)})`)
    } else if (ts.isElementAccessExpression(lhs)) {
      const obj = emitExpr(lhs.expression, indent)
      const key = emitExpr(lhs.argumentExpression, indent)
      const cur = `RT.get_prop(${obj}, ${key})`
      lines.push(`${indent}RT.set_prop(${obj}, ${key}, ${applyOp(cur, rhs.value)})`)
    }
    return lines
  }

  function emitUnaryMutStmt(operand: ts.Expression, delta: 1 | -1, indent: string): string[] {
    const lhs = unwrapTs(operand)
    const sign = delta > 0 ? '+ 1' : '- 1'
    if (ts.isIdentifier(lhs)) {
      const target = varRef(lhs.text)
      return [`${indent}${target} = ${target} ${sign}`]
    }
    if (ts.isPropertyAccessExpression(lhs)) {
      const obj = emitExpr(lhs.expression, indent)
      const key = gdString(lhs.name.text)
      return [`${indent}RT.set_prop(${obj}, ${key}, RT.get_prop(${obj}, ${key}) ${sign})`]
    }
    if (ts.isElementAccessExpression(lhs)) {
      const obj = emitExpr(lhs.expression, indent)
      const key = emitExpr(lhs.argumentExpression, indent)
      return [`${indent}RT.set_prop(${obj}, ${key}, RT.get_prop(${obj}, ${key}) ${sign})`]
    }
    return []
  }

  function emitScopedBody(stmt: ts.Statement, indent: string): string[] {
    pushBlockScope()
    try {
      return ts.isBlock(stmt)
        ? emitBlockStatements(stmt.statements, indent)
        : emitStmt(stmt, indent)
    } finally {
      popBlockScope()
    }
  }

  function emitStmt(stmt: ts.Statement, indent: string, isModuleTop = false): string[] {
    if (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isImportDeclaration(stmt) || ts.isEmptyStatement(stmt)) {
      return []
    }
    if (ts.isVariableStatement(stmt)) {
      return withHoist(indent, () => {
        const out: string[] = []
        for (const decl of stmt.declarationList.declarations) {
          const rhs = decl.initializer ? emitExpr(decl.initializer, indent) : 'null'
          out.push(...emitBindingDecls(decl.name, rhs, indent, isModuleTop))
        }
        return out
      })
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      if (isModuleTop) return [] // Emitted as top-level `func` below
      return withHoist(indent, () => {
        const fnName = declareLocal(stmt.name!.text)
        const lam = emitLambda(stmt.parameters, stmt.body, indent)
        return [`${indent}var ${fnName} = ${lam}`]
      })
    }
    if (ts.isReturnStatement(stmt)) {
      return withHoist(indent, () => [stmt.expression ? `${indent}return ${emitExpr(stmt.expression, indent)}` : `${indent}return`])
    }
    if (ts.isBreakStatement(stmt)) return [`${indent}break`]
    if (ts.isContinueStatement(stmt)) return [`${indent}continue`]
    if (ts.isThrowStatement(stmt)) {
      return withHoist(indent, () => [`${indent}assert(false, str(${emitExpr(stmt.expression, indent)}))`])
    }
    if (ts.isIfStatement(stmt)) {
      const condLines = withHoist(indent, () => [`${indent}if RT.truthy(${emitExpr(stmt.expression, indent)}):`])
      const lines = [...condLines]
      const thenBody = emitScopedBody(stmt.thenStatement, indent + '\t')
      lines.push(...(thenBody.length ? thenBody : [`${indent}\tpass`]))
      if (stmt.elseStatement) {
        if (ts.isIfStatement(stmt.elseStatement)) {
          const elifLines = emitStmt(stmt.elseStatement, indent)
          if (elifLines[0]?.startsWith(`${indent}if `)) {
            elifLines[0] = elifLines[0].replace(/^(\t*)if /, '$1elif ')
            lines.push(...elifLines)
          } else {
            lines.push(`${indent}else:`)
            lines.push(...emitStmt(stmt.elseStatement, indent + '\t'))
          }
        } else {
          lines.push(`${indent}else:`)
          const elseBody = emitScopedBody(stmt.elseStatement, indent + '\t')
          lines.push(...(elseBody.length ? elseBody : [`${indent}\tpass`]))
        }
      }
      return lines
    }
    if (ts.isSwitchStatement(stmt)) {
      const disc = nextTemp('_sw')
      const lines = withHoist(indent, () => [`${indent}var ${disc} = ${emitExpr(stmt.expression, indent)}`])
      let first = true
      for (const clause of stmt.caseBlock.clauses) {
        if (ts.isCaseClause(clause)) {
          const kw = first ? 'if' : 'elif'
          first = false
          lines.push(`${indent}${kw} RT.eq(${disc}, ${emitExpr(clause.expression, indent)}):`)
        } else {
          lines.push(first ? `${indent}if true:` : `${indent}else:`)
          first = false
        }
        pushBlockScope()
        const body = emitBlockStatements(clause.statements.filter(s => !ts.isBreakStatement(s)), indent + '\t')
        popBlockScope()
        lines.push(...(body.length ? body : [`${indent}\tpass`]))
      }
      return lines
    }
    if (ts.isForOfStatement(stmt)) {
      pushBlockScope()
      try {
        const loopVar = nextTemp('_el')
        const header = withHoist(indent, () => [`${indent}for ${loopVar} in RT.iter(${emitExpr(stmt.expression, indent)}):`])
        const lines = [...header]
        if (ts.isVariableDeclarationList(stmt.initializer)) {
          const decl = stmt.initializer.declarations[0]
          lines.push(...withHoist(indent + '\t', () => emitBindingDecls(decl.name, loopVar, indent + '\t', false)))
        }
        const body = emitScopedBody(stmt.statement, indent + '\t')
        lines.push(...(body.length ? body : [`${indent}\tpass`]))
        return lines
      } finally {
        popBlockScope()
      }
    }
    if (ts.isForStatement(stmt)) {
      pushBlockScope()
      try {
        const lines: string[] = []
        if (stmt.initializer) {
          if (ts.isVariableDeclarationList(stmt.initializer)) {
            lines.push(...withHoist(indent, () => {
              const initOut: string[] = []
              for (const decl of (stmt.initializer as ts.VariableDeclarationList).declarations) {
                initOut.push(...emitBindingDecls(decl.name, decl.initializer ? emitExpr(decl.initializer, indent) : 'null', indent, false))
              }
              return initOut
            }))
          } else {
            lines.push(...withHoist(indent, () => emitExprStmt(stmt.initializer as ts.Expression, indent)))
          }
        }
        if (stmt.incrementor) {
          const firstFlag = nextTemp('_f')
          lines.push(`${indent}var ${firstFlag} := true`)
          lines.push(`${indent}while true:`)
          lines.push(`${indent}\tif ${firstFlag}:`)
          lines.push(`${indent}\t\t${firstFlag} = false`)
          lines.push(`${indent}\telse:`)
          lines.push(...withHoist(indent + '\t\t', () => emitExprStmt(stmt.incrementor!, indent + '\t\t')))
          if (stmt.condition) {
            lines.push(...withHoist(indent + '\t', () => [
              `${indent}\tif not RT.truthy(${emitExpr(stmt.condition!, indent + '\t')}):`,
              `${indent}\t\tbreak`
            ]))
          }
          const body = emitScopedBody(stmt.statement, indent + '\t')
          lines.push(...(body.length ? body : [`${indent}\tpass`]))
        } else {
          const cond = stmt.condition ? `RT.truthy(${emitExpr(stmt.condition, indent)})` : 'true'
          lines.push(`${indent}while ${cond}:`)
          const body = emitScopedBody(stmt.statement, indent + '\t')
          lines.push(...(body.length ? body : [`${indent}\tpass`]))
        }
        return lines
      } finally {
        popBlockScope()
      }
    }
    if (ts.isWhileStatement(stmt)) {
      const lines = [`${indent}while RT.truthy(${emitExpr(stmt.expression, indent)}):`]
      const body = emitScopedBody(stmt.statement, indent + '\t')
      lines.push(...(body.length ? body : [`${indent}\tpass`]))
      return lines
    }
    if (ts.isBlock(stmt)) {
      return emitScopedBody(stmt, indent)
    }
    if (ts.isTryStatement(stmt)) {
      return emitScopedBody(stmt.tryBlock, indent)
    }
    if (ts.isExpressionStatement(stmt)) {
      return withHoist(indent, () => emitExprStmt(stmt.expression, indent))
    }
    return []
  }

  function emitExprStmt(expr: ts.Expression, indent: string): string[] {
    const node = unwrapTs(expr)
    if (ts.isBinaryExpression(node) && isAssignmentOp(node.operatorToken.kind)) {
      return emitAssignStmt(node, indent)
    }
    if (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) {
      if (node.operator === ts.SyntaxKind.PlusPlusToken) return emitUnaryMutStmt(node.operand, 1, indent)
      if (node.operator === ts.SyntaxKind.MinusMinusToken) return emitUnaryMutStmt(node.operand, -1, indent)
    }
    return [`${indent}${emitExpr(node, indent)}`]
  }

  function emitBlockStatements(stmts: readonly ts.Statement[], indent: string): string[] {
    const out: string[] = []
    for (const stmt of stmts) out.push(...emitStmt(stmt, indent, false))
    return out
  }

  // Assemble the compiled GDScript module.
  const lines: string[] = [
    'extends RefCounted',
    `# Compiled from ${fileName} by Ridgetop TS -> GDScript 4 compiler.`,
    `const RT = preload(${gdString(rtResPath)})`,
    ''
  ]

  for (const name of topVars) {
    lines.push(`var ${safeIdent(name)}`)
  }
  if (topVars.size) lines.push('')

  // Module initializer loads imports and runs top-level variable initializers in source order.
  pushFuncScope()
  const initBody: string[] = []
  for (const [local, ref] of importedBindings) {
    initBody.push(`\t${safeIdent(local)} = RT.get_prop(RT.mod(${gdString(ref.resPath)}), ${gdString(safeIdent(ref.exportName))})`)
  }
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt)) continue
    initBody.push(...emitStmt(stmt, '\t', true))
  }
  popFuncScope()
  lines.push('func __init_module() -> void:')
  lines.push(...(initBody.length ? initBody : ['\tpass']))
  lines.push('')

  // Top-level functions become real GDScript methods on the module instance.
  for (const stmt of sf.statements) {
    if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body) continue
    pushFuncScope()
    const fnName = safeIdent(stmt.name.text)
    const { sig, prelude } = emitParams(stmt.parameters, '\t')
    const body = emitBlockStatements(stmt.body.statements, '\t')
    popFuncScope()
    lines.push(`func ${fnName}(${sig}):`)
    const all = [...prelude, ...body]
    lines.push(...(all.length ? all : ['\tpass']))
    lines.push('')
  }

  return lines.join('\n')
}

export interface CompileProjectOptions {
  /** Absolute paths to root TypeScript modules to compile (all local imports are followed automatically). */
  entries: readonly string[]
  /** Project root used to compute relative output paths (e.g. `framework/platformer.ts` -> `outDir/framework/platformer.gd`). */
  rootDir: string
  /** Destination directory for compiled `.gd` files and `rt.gd`. */
  outDir: string
  /** Godot `res://` prefix corresponding to `outDir` (default: `res://scripts/compiled`). */
  resPrefix?: string
}

async function resolveLocalModulePath(fromFile: string, specifier: string): Promise<string> {
  const raw = resolve(dirname(fromFile), specifier)
  if (raw.endsWith('.js')) {
    const asTs = raw.replace(/\.js$/, '.ts')
    try { await access(asTs); return asTs } catch {}
  }
  return raw
}

/** Resolve re-export barrels (like `framework/index.ts` or `framework/ui.ts`) to the actual defining `.ts`/`.js` file. */
async function resolveThroughBarrel(filePath: string, symbol: string, cache: Map<string, ts.SourceFile>): Promise<{ file: string; symbol: string }> {
  let currentFile = filePath
  let currentSymbol = symbol
  for (let depth = 0; depth < 6; depth++) {
    let sf = cache.get(currentFile)
    if (!sf) {
      sf = ts.createSourceFile(currentFile, await readFile(currentFile, 'utf8'), ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
      cache.set(currentFile, sf)
    }
    let forwarded = false
    for (const stmt of sf.statements) {
      if (!ts.isExportDeclaration(stmt) || stmt.isTypeOnly || !stmt.moduleSpecifier) continue
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text
      if (!spec.startsWith('.')) continue
      const target = await resolveLocalModulePath(currentFile, spec)
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (el.isTypeOnly) continue
          if (el.name.text === currentSymbol) {
            currentFile = target
            currentSymbol = (el.propertyName ?? el.name).text
            forwarded = true
            break
          }
        }
      }
      if (forwarded) break
    }
    if (!forwarded) break
  }
  return { file: currentFile, symbol: currentSymbol }
}

/** Compile a TypeScript module graph into a self-contained set of Godot 4 `.gd` files + `rt.gd`. */
export async function compileTsProjectToGodot(options: CompileProjectOptions): Promise<{ files: string[]; rtPath: string }> {
  const rootDir = resolve(options.rootDir)
  const outDir = resolve(options.outDir)
  const resPrefix = (options.resPrefix ?? 'res://scripts/compiled').replace(/\/$/, '')
  const rtResPath = `${resPrefix}/rt.gd`

  await mkdir(outDir, { recursive: true })
  const rtPath = join(outDir, 'rt.gd')
  await writeFile(rtPath, renderRtGd())

  const astCache = new Map<string, ts.SourceFile>()
  const visited = new Set<string>()
  const emitted: string[] = []

  async function compileOne(absFile: string) {
    const normalized = resolve(absFile)
    if (visited.has(normalized)) return
    visited.add(normalized)

    const source = await readFile(normalized, 'utf8')
    let sf = astCache.get(normalized)
    if (!sf) {
      sf = ts.createSourceFile(normalized, source, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS)
      astCache.set(normalized, sf)
    }

    // Pre-resolve every runtime import specifier + symbol through barrels so all dependencies are compiled too.
    const importMap = new Map<string, { resPath: string; exportName: string; absTarget: string }>()
    for (const stmt of sf.statements) {
      if (!ts.isImportDeclaration(stmt) || stmt.importClause?.isTypeOnly) continue
      const spec = (stmt.moduleSpecifier as ts.StringLiteral).text
      if (!spec.startsWith('.')) continue
      const direct = await resolveLocalModulePath(normalized, spec)
      const bindings = stmt.importClause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          if (el.isTypeOnly) continue
          const imported = (el.propertyName ?? el.name).text
          const resolved = await resolveThroughBarrel(direct, imported, astCache)
          const relOut = relative(rootDir, resolved.file).replace(/\\/g, '/').replace(/\.(?:ts|js)$/, '.gd')
          importMap.set(`${spec}::${imported}`, {
            resPath: `${resPrefix}/${relOut}`,
            exportName: resolved.symbol,
            absTarget: resolved.file
          })
        }
      }
    }

    for (const dep of importMap.values()) await compileOne(dep.absTarget)

    const relDisplay = relative(rootDir, normalized).replace(/\\/g, '/')
    const gd = compileTsToGd(source, relDisplay, {
      rtResPath,
      resolveImport(specifier, exportedName) {
        const hit = importMap.get(`${specifier}::${exportedName}`)
        if (hit) return { resPath: hit.resPath, exportName: hit.exportName }
        const fallback = relative(rootDir, resolve(dirname(normalized), specifier.replace(/\.js$/, '.ts')))
          .replace(/\\/g, '/').replace(/\.(?:ts|js)$/, '.gd')
        return { resPath: `${resPrefix}/${fallback}`, exportName: exportedName }
      }
    })

    const outFile = join(outDir, relDisplay.replace(/\.(?:ts|js)$/, '.gd'))
    await mkdir(dirname(outFile), { recursive: true })
    await writeFile(outFile, gd)
    emitted.push(outFile)
  }

  for (const entry of options.entries) await compileOne(entry)
  return { files: emitted, rtPath }
}

if (isMain(import.meta.url)) {
  const [, , outDir, ...entries] = process.argv
  if (!outDir || !entries.length || outDir === '--help') {
    console.log('Usage: node tools/ts-to-gd.ts <out-dir> <entry1.ts> [entry2.ts ...]')
    process.exitCode = outDir === '--help' ? 0 : 1
  } else {
    const result = await compileTsProjectToGodot({
      entries: entries.map(e => resolve(e)),
      rootDir: process.cwd(),
      outDir: resolve(outDir)
    })
    console.log(`Compiled ${result.files.length} TypeScript module(s) to GDScript in ${outDir}`)
  }
}
