extends RefCounted

# Ridgetop TypeScript -> GDScript 4 Runtime Support (RT)
# Provides exact JS semantics for compiled TypeScript modules (truthiness, float modulo,
# array higher-order methods, dict/array spread, and singleton ES module loading).

static var _modules: Dictionary = {}

static func mod(res_path: String) -> Object:
	if _modules.has(res_path):
		return _modules[res_path]
	var script = load(res_path)
	assert(script != null, "Failed to load compiled Ridgetop module: " + res_path)
	var instance = script.new()
	_modules[res_path] = instance
	if instance.has_method("__init_module"):
		instance.__init_module()
	return instance

static func clear_modules() -> void:
	_modules.clear()

static func truthy(v: Variant) -> bool:
	if v == null:
		return false
	var t := typeof(v)
	if t == TYPE_BOOL:
		return v
	if t == TYPE_INT:
		return v != 0
	if t == TYPE_FLOAT:
		return v != 0.0 and not is_nan(v)
	if t == TYPE_STRING:
		return (v as String).length() > 0
	# Arrays, Dictionaries, Objects, and Callables are always truthy in JavaScript!
	return true

static func num(v: Variant) -> float:
	if v == null:
		return 0.0
	var t := typeof(v)
	if t == TYPE_BOOL:
		return 1.0 if v else 0.0
	if t == TYPE_INT or t == TYPE_FLOAT:
		return float(v)
	if t == TYPE_STRING:
		var s := (v as String).strip_edges()
		if s == "":
			return 0.0
		return float(s) if s.is_valid_float() else NAN
	return NAN

static func js_str(v: Variant) -> String:
	if v == null:
		return "null"
	var t := typeof(v)
	if t == TYPE_FLOAT:
		var f := float(v)
		if is_finite(f) and floor(f) == f and absf(f) < 9007199254740992.0:
			return str(int(f))
	return str(v)

static func add(a: Variant, b: Variant) -> Variant:
	if typeof(a) == TYPE_STRING or typeof(b) == TYPE_STRING:
		return js_str(a) + js_str(b)
	return num(a) + num(b)

static func eq(a: Variant, b: Variant) -> bool:
	if a == null and b == null:
		return true
	if a == null or b == null:
		return false
	var ta := typeof(a)
	var tb := typeof(b)
	if (ta == TYPE_INT or ta == TYPE_FLOAT) and (tb == TYPE_INT or tb == TYPE_FLOAT):
		return float(a) == float(b)
	if ta != tb:
		return false
	if ta == TYPE_ARRAY or ta == TYPE_DICTIONARY or ta == TYPE_OBJECT:
		return is_same(a, b)
	return a == b

static func rem(a: Variant, b: Variant) -> float:
	return fmod(num(a), num(b))

static func is_finite_num(v: Variant) -> bool:
	var t := typeof(v)
	if t == TYPE_INT:
		return true
	if t == TYPE_FLOAT:
		return is_finite(float(v))
	return false

static func is_nan_num(v: Variant) -> bool:
	return typeof(v) == TYPE_FLOAT and is_nan(float(v))

static func is_int(v: Variant) -> bool:
	var t := typeof(v)
	if t == TYPE_INT:
		return true
	if t == TYPE_FLOAT:
		var f := float(v)
		return is_finite(f) and floor(f) == f
	return false

static func is_safe_int(v: Variant) -> bool:
	var t := typeof(v)
	if t == TYPE_INT:
		var n := int(v)
		return n >= -9007199254740991 and n <= 9007199254740991
	if t == TYPE_FLOAT:
		var f := float(v)
		return is_finite(f) and floor(f) == f and f >= -9007199254740991.0 and f <= 9007199254740991.0
	return false

static func is_array(v: Variant) -> bool:
	return v is Array

static func js_round(v: Variant) -> float:
	var f := num(v)
	if is_nan(f) or is_inf(f):
		return f
	return floor(f + 0.5)

static func js_trunc(v: Variant) -> float:
	var f := num(v)
	if is_nan(f) or is_inf(f):
		return f
	return floor(f) if f >= 0.0 else ceil(f)

static func i32(v: Variant) -> int:
	if typeof(v) == TYPE_INT:
		var ni := (v as int) & 0xFFFFFFFF
		return ni - 0x100000000 if ni >= 0x80000000 else ni
	var f := num(v)
	if not is_finite(f):
		return 0
	var n := int(fmod(js_trunc(f), 4294967296.0)) & 0xFFFFFFFF
	return n - 0x100000000 if n >= 0x80000000 else n

static func imul(a: Variant, b: Variant) -> int:
	return i32(i32(a) * i32(b))

static func max_two(a: Variant, b: Variant) -> float:
	var fa := num(a)
	var fb := num(b)
	if is_nan(fa) or is_nan(fb):
		return NAN
	return fa if fa >= fb else fb

static func min_two(a: Variant, b: Variant) -> float:
	var fa := num(a)
	var fb := num(b)
	if is_nan(fa) or is_nan(fb):
		return NAN
	return fa if fa <= fb else fb

static func hypot(args: Array) -> float:
	var sum := 0.0
	for a in args:
		var f := num(a)
		sum += f * f
	return sqrt(sum)

static func max_all(args: Array) -> float:
	var best := -INF
	for a in args:
		var f := num(a)
		if is_nan(f):
			return NAN
		if f > best:
			best = f
	return best

static func min_all(args: Array) -> float:
	var best := INF
	for a in args:
		var f := num(a)
		if is_nan(f):
			return NAN
		if f < best:
			best = f
	return best

static func prop_len(v: Variant) -> Variant:
	if v == null:
		return null
	if v is Array:
		return (v as Array).size()
	if v is String:
		return (v as String).length()
	if v is Dictionary:
		return get_prop(v, "length")
	return null

static func prop_size(v: Variant) -> Variant:
	if v == null:
		return null
	if v is Dictionary:
		var d := v as Dictionary
		if (d.has("__is_map") or d.has("__is_set")) and d.has("__store"):
			return (d["__store"] as Dictionary).size()
		return get_prop(d, "size")
	return null

static func len_of(v: Variant) -> int:
	if v == null:
		return 0
	if v is Array:
		return (v as Array).size()
	if v is Dictionary:
		var d := v as Dictionary
		if d.has("__store"):
			return (d["__store"] as Dictionary).size()
		return d.size()
	if v is String:
		return (v as String).length()
	return 0

static func type_of(v: Variant) -> String:
	if v == null:
		return "undefined"
	var t := typeof(v)
	if t == TYPE_BOOL:
		return "boolean"
	if t == TYPE_INT or t == TYPE_FLOAT:
		return "number"
	if t == TYPE_STRING:
		return "string"
	if t == TYPE_CALLABLE:
		return "function"
	return "object"

static func iter(v: Variant) -> Variant:
	if v == null:
		return []
	if v is Dictionary:
		var d := v as Dictionary
		if d.has("__is_set"):
			return (d["__store"] as Dictionary).keys()
		if d.has("__is_map"):
			return obj_entries(d["__store"] as Dictionary)
	return v

static func norm_key(key: Variant) -> Variant:
	if typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT:
		return js_str(key)
	return key

static func has_prop(obj: Variant, key: Variant) -> bool:
	if obj is Dictionary:
		var d := obj as Dictionary
		if d.has(key):
			return true
		if typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT:
			return d.has(js_str(key))
		return false
	if obj is Array:
		if key is String and (key as String) == "length":
			return true
		if typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT or (key is String and (key as String).is_valid_int()):
			var idx := int(key)
			return idx >= 0 and idx < (obj as Array).size()
	return false

static func get_prop(obj: Variant, key: Variant) -> Variant:
	if obj == null:
		return null
	if obj is Dictionary:
		var d := obj as Dictionary
		if d.has("__is_map") and key is String:
			var sk := key as String
			var store := d["__store"] as Dictionary
			if sk == "size":
				return store.size()
			if sk == "get":
				return func(k): return store.get(k, null)
			if sk == "set":
				return func(k, val):
					store[k] = val
					return d
			if sk == "has":
				return func(k): return store.has(k)
			if sk == "delete":
				return func(k): return store.erase(k)
			if sk == "clear":
				return func(): store.clear()
			if sk == "keys":
				return func(): return store.keys()
			if sk == "values":
				return func(): return store.values()
			if sk == "entries":
				return func(): return obj_entries(store)
		if d.has("__is_set") and key is String:
			var sk := key as String
			var store := d["__store"] as Dictionary
			if sk == "size":
				return store.size()
			if sk == "add":
				return func(val):
					store[val] = true
					return d
			if sk == "has":
				return func(val): return store.has(val)
			if sk == "delete":
				return func(val): return store.erase(val)
			if sk == "clear":
				return func(): store.clear()
			if sk == "values":
				return func(): return store.keys()
		var v: Variant = null
		if d.has(key):
			v = d[key]
		elif (typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT) and d.has(js_str(key)):
			v = d[js_str(key)]
		if v is Dictionary and (v as Dictionary).has("__rt_getter"):
			return ((v as Dictionary)["__rt_getter"] as Callable).call()
		return v
	if obj is Array:
		if typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT or (key is String and (key as String).is_valid_int()):
			var idx := int(key)
			var arr := obj as Array
			return arr[idx] if idx >= 0 and idx < arr.size() else null
		return null
	if obj is String:
		if typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT or (key is String and (key as String).is_valid_int()):
			var idx := int(key)
			var s := obj as String
			return s.substr(idx, 1) if idx >= 0 and idx < s.length() else null
		return null
	if obj is Object:
		var s := str(key)
		if s in obj:
			return obj.get(s)
		if obj.has_method(s):
			return Callable(obj, s)
	return null

static func set_prop(obj: Variant, key: Variant, value: Variant) -> Variant:
	if obj is Dictionary:
		var d := obj as Dictionary
		if typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT:
			var sk := js_str(key)
			if d.has(key) and not d.has(sk):
				d.erase(key)
			d[sk] = value
		else:
			d[key] = value
	elif obj is Array:
		var arr := obj as Array
		if key is String and (key as String) == "length":
			arr.resize(maxi(0, int(num(value))))
		elif typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT or (key is String and (key as String).is_valid_int()):
			var idx := int(key)
			if idx >= 0:
				if idx >= arr.size():
					arr.resize(idx + 1)
				arr[idx] = value
	elif obj is Object:
		obj.set(str(key), value)
	return value

static func del_prop(obj: Variant, key: Variant) -> bool:
	if obj is Dictionary:
		var d := obj as Dictionary
		if d.has(key):
			d.erase(key)
			return true
		if typeof(key) == TYPE_INT or typeof(key) == TYPE_FLOAT:
			var sk := js_str(key)
			if d.has(sk):
				d.erase(sk)
				return true
	return true

static func omit_dict(src: Variant, excluded: Array) -> Dictionary:
	var out: Dictionary = {}
	if src is Dictionary:
		var d := src as Dictionary
		for k in d.keys():
			if not excluded.has(k) and not excluded.has(js_str(k)):
				out[k] = get_prop(d, k)
	return out

const UNDEF := "__rt_undef_sentinel__"

static func pack_rest(args: Array) -> Array:
	var out: Array = []
	for item in args:
		if item is String and (item as String) == UNDEF:
			break
		out.append(item)
	return out

static func invoke(callee: Variant, args: Array) -> Variant:
	if callee is Callable:
		var fn := callee as Callable
		var argc := fn.get_argument_count()
		if argc >= 0 and args.size() > argc:
			return fn.callv(args.slice(0, argc))
		return fn.callv(args)
	push_error("Attempted to call non-callable value: " + str(callee))
	return null

static func invoke_opt(callee: Variant, args: Array) -> Variant:
	if callee == null:
		return null
	return invoke(callee, args)

static func _call_cb(cb: Callable, item: Variant, index: int, arr: Array) -> Variant:
	var argc := cb.get_argument_count()
	if argc <= 0:
		return cb.call()
	if argc == 1:
		return cb.call(item)
	if argc == 2:
		return cb.call(item, index)
	return cb.call(item, index, arr)

static func map(target: Variant, cb: Callable) -> Variant:
	if target is Dictionary and (target as Dictionary).has("map"):
		return invoke((target as Dictionary)["map"], [cb])
	var arr := target as Array
	var out: Array = []
	for i in range(arr.size()):
		out.append(_call_cb(cb, arr[i], i, arr))
	return out

static func filter(target: Variant, cb: Callable) -> Variant:
	if target is Dictionary and (target as Dictionary).has("filter"):
		return invoke((target as Dictionary)["filter"], [cb])
	var arr := target as Array
	var out: Array = []
	for i in range(arr.size()):
		if truthy(_call_cb(cb, arr[i], i, arr)):
			out.append(arr[i])
	return out

static func some(target: Variant, cb: Callable) -> Variant:
	if target is Dictionary and (target as Dictionary).has("some"):
		return invoke((target as Dictionary)["some"], [cb])
	var arr := target as Array
	for i in range(arr.size()):
		if truthy(_call_cb(cb, arr[i], i, arr)):
			return true
	return false

static func every(target: Variant, cb: Callable) -> Variant:
	if target is Dictionary and (target as Dictionary).has("every"):
		return invoke((target as Dictionary)["every"], [cb])
	var arr := target as Array
	for i in range(arr.size()):
		if not truthy(_call_cb(cb, arr[i], i, arr)):
			return false
	return true

static func find(target: Variant, cb: Callable) -> Variant:
	if target is Dictionary and (target as Dictionary).has("find"):
		return invoke((target as Dictionary)["find"], [cb])
	var arr := target as Array
	for i in range(arr.size()):
		if truthy(_call_cb(cb, arr[i], i, arr)):
			return arr[i]
	return null

static func find_index(target: Variant, cb: Callable) -> Variant:
	if target is Dictionary and (target as Dictionary).has("findIndex"):
		return invoke((target as Dictionary)["findIndex"], [cb])
	var arr := target as Array
	for i in range(arr.size()):
		if truthy(_call_cb(cb, arr[i], i, arr)):
			return i
	return -1

static func for_each(target: Variant, cb: Callable) -> void:
	if target is Dictionary:
		var d := target as Dictionary
		if d.has("__is_map"):
			var store := d["__store"] as Dictionary
			var argc := cb.get_argument_count()
			for k in store.keys():
				if argc <= 0:
					cb.call()
				elif argc == 1:
					cb.call(store[k])
				elif argc == 2:
					cb.call(store[k], k)
				else:
					cb.call(store[k], k, target)
			return
		if d.has("__is_set"):
			var store := d["__store"] as Dictionary
			var argc := cb.get_argument_count()
			for k in store.keys():
				if argc <= 0:
					cb.call()
				elif argc == 1:
					cb.call(k)
				elif argc == 2:
					cb.call(k, k)
				else:
					cb.call(k, k, target)
			return
		if d.has("forEach"):
			invoke(d["forEach"], [cb])
			return
	var arr := target as Array
	for i in range(arr.size()):
		_call_cb(cb, arr[i], i, arr)

static func reduce(target: Variant, cb: Callable, has_init: bool, init: Variant = null) -> Variant:
	if target is Dictionary and (target as Dictionary).has("reduce"):
		return invoke((target as Dictionary)["reduce"], [cb, init] if has_init else [cb])
	var arr := target as Array
	if not has_init and arr.is_empty():
		return null
	var acc: Variant = init if has_init else arr[0]
	var start := 0 if has_init else 1
	var argc := cb.get_argument_count()
	for i in range(start, arr.size()):
		if argc <= 0:
			acc = cb.call()
		elif argc == 1:
			acc = cb.call(acc)
		elif argc == 2:
			acc = cb.call(acc, arr[i])
		elif argc == 3:
			acc = cb.call(acc, arr[i], i)
		else:
			acc = cb.call(acc, arr[i], i, arr)
	return acc

static func slice(arr: Variant, start: Variant = 0, end_idx: Variant = null) -> Variant:
	if arr is Dictionary and (arr as Dictionary).has("slice"):
		return invoke((arr as Dictionary)["slice"], [start, end_idx] if end_idx != null else [start])
	var s_raw := 0 if start == null else int(num(start))
	if arr is Array:
		var a := arr as Array
		var n := a.size()
		var s := maxi(0, n + s_raw if s_raw < 0 else s_raw)
		var e := n if end_idx == null else maxi(0, n + int(num(end_idx)) if int(num(end_idx)) < 0 else mini(n, int(num(end_idx))))
		return a.slice(s, e)
	if arr is String:
		var st := arr as String
		var n := st.length()
		var s := maxi(0, n + s_raw if s_raw < 0 else s_raw)
		var e := n if end_idx == null else maxi(0, n + int(num(end_idx)) if int(num(end_idx)) < 0 else mini(n, int(num(end_idx))))
		return st.substr(s, maxi(0, e - s))
	return []

static func at(target: Variant, idx: Variant = 0) -> Variant:
	if target is Dictionary and (target as Dictionary).has("at"):
		return invoke((target as Dictionary)["at"], [idx])
	var raw := 0 if idx == null else int(num(idx))
	if target is Array:
		var arr := target as Array
		var i := arr.size() + raw if raw < 0 else raw
		return arr[i] if i >= 0 and i < arr.size() else null
	if target is String:
		var s := target as String
		var i := s.length() + raw if raw < 0 else raw
		return s.substr(i, 1) if i >= 0 and i < s.length() else null
	return null

static func entries(target: Variant) -> Array:
	if target is Dictionary:
		var d := target as Dictionary
		if d.has("__is_map"):
			return obj_entries(d["__store"] as Dictionary)
		if d.has("entries"):
			return invoke(d["entries"], [])
	var arr := target as Array
	var out: Array = []
	for i in range(arr.size()):
		out.append([i, arr[i]])
	return out

static func index_of(container: Variant, value: Variant, from_idx: Variant = 0) -> Variant:
	if container is Dictionary and (container as Dictionary).has("indexOf"):
		return invoke((container as Dictionary)["indexOf"], [value, from_idx])
	var fi := 0 if from_idx == null else int(num(from_idx))
	if container is Array:
		var arr := container as Array
		var start := maxi(0, arr.size() + fi if fi < 0 else fi)
		for i in range(start, arr.size()):
			if eq(arr[i], value):
				return i
		return -1
	if container is String:
		return (container as String).find(js_str(value), maxi(0, fi))
	return -1

static func includes(container: Variant, value: Variant) -> Variant:
	if container is Dictionary and (container as Dictionary).has("includes"):
		return invoke((container as Dictionary)["includes"], [value])
	if container is Array:
		for item in container:
			if eq(item, value):
				return true
		return false
	if container is String:
		return (container as String).contains(js_str(value))
	return false

static func sort_arr(target: Variant, cmp: Variant = null) -> Variant:
	if target is Dictionary and (target as Dictionary).has("sort"):
		return invoke((target as Dictionary)["sort"], [cmp] if cmp != null else [])
	var arr := target as Array
	if cmp is Callable:
		var fn := cmp as Callable
		arr.sort_custom(func(a, b): return num(fn.call(a, b)) < 0.0)
	else:
		arr.sort_custom(func(a, b): return js_str(a) < js_str(b))
	return arr

static func splice_arr(target: Variant, start: Variant = 0, delete_count: Variant = null, items: Array = []) -> Variant:
	if target is Dictionary and (target as Dictionary).has("splice"):
		var call_args: Array = [start]
		if delete_count != null:
			call_args.append(delete_count)
		call_args.append_array(items)
		return invoke((target as Dictionary)["splice"], call_args)
	var arr := target as Array
	var n := arr.size()
	var s_raw := 0 if start == null else int(num(start))
	var s := clampi(n + s_raw if s_raw < 0 else s_raw, 0, n)
	var dc := n - s if delete_count == null else clampi(int(num(delete_count)), 0, n - s)
	var removed: Array = []
	for _i in range(dc):
		removed.append(arr[s])
		arr.remove_at(s)
	for idx in range(items.size()):
		arr.insert(s + idx, items[idx])
	return removed

static func pop_arr(target: Variant) -> Variant:
	if target is Dictionary and (target as Dictionary).has("pop"):
		return invoke((target as Dictionary)["pop"], [])
	return (target as Array).pop_back()

static func shift_arr(target: Variant) -> Variant:
	if target is Dictionary and (target as Dictionary).has("shift"):
		return invoke((target as Dictionary)["shift"], [])
	return (target as Array).pop_front()

static func join_arr(target: Variant, sep: Variant = ",") -> Variant:
	if target is Dictionary and (target as Dictionary).has("join"):
		return invoke((target as Dictionary)["join"], [sep])
	var d := "," if sep == null else js_str(sep)
	var arr := target as Array
	var parts := PackedStringArray()
	for item in arr:
		parts.append(js_str(item))
	return d.join(parts)

static func str_pad_start(raw_s: Variant, target_len: Variant = 0, raw_pad: Variant = " ") -> Variant:
	if raw_s is Dictionary and (raw_s as Dictionary).has("padStart"):
		return invoke((raw_s as Dictionary)["padStart"], [target_len, raw_pad])
	var s := js_str(raw_s)
	var tlen := 0 if target_len == null else int(num(target_len))
	var pad := " " if raw_pad == null else js_str(raw_pad)
	if s.length() >= tlen or pad.is_empty():
		return s
	var needed := tlen - s.length()
	var prefix := ""
	while prefix.length() < needed:
		prefix += pad
	return prefix.substr(0, needed) + s

static func str_split(raw_s: Variant, sep: Variant = null) -> Variant:
	if raw_s is Dictionary and (raw_s as Dictionary).has("split"):
		return invoke((raw_s as Dictionary)["split"], [sep] if sep != null else [])
	var s := js_str(raw_s)
	if sep == null:
		return [s]
	var d := js_str(sep)
	if d == "":
		var chars: Array = []
		for i in range(s.length()):
			chars.append(s.substr(i, 1))
		return chars
	var out: Array = []
	for part in s.split(d):
		out.append(part)
	return out

static func spread_dict(parts: Array) -> Dictionary:
	var out: Dictionary = {}
	for part in parts:
		if part is Dictionary:
			for k in (part as Dictionary).keys():
				out[k] = part[k]
	return out

static func spread_arr(parts: Array) -> Array:
	var out: Array = []
	for part in parts:
		if part is Array:
			out.append_array(part as Array)
		elif part is String:
			var s := part as String
			for i in range(s.length()):
				out.append(s.substr(i, 1))
		elif part is Dictionary:
			for item in iter(part):
				out.append(item)
		elif part != null:
			out.append(part)
	return out

static func assign(target: Dictionary, sources: Array) -> Dictionary:
	for src in sources:
		if src is Dictionary:
			for k in (src as Dictionary).keys():
				target[k] = src[k]
	return target

static func obj_entries(d: Dictionary) -> Array:
	var out: Array = []
	for k in d.keys():
		out.append([k, d[k]])
	return out

static func from_entries(pairs: Array) -> Dictionary:
	var out: Dictionary = {}
	for p in pairs:
		out[p[0]] = p[1]
	return out

static func push_many(target: Variant, items: Array) -> Variant:
	if target is Dictionary and (target as Dictionary).has("push"):
		return invoke((target as Dictionary)["push"], items)
	var arr := target as Array
	arr.append_array(items)
	return arr.size()

static func call_set(target: Variant, args: Array) -> Variant:
	if target is Array:
		var dst := target as Array
		var src: Variant = iter(args[0]) if args.size() > 0 else []
		var offset := int(args[1]) if args.size() > 1 and args[1] != null else 0
		if src is Array:
			var s := src as Array
			for i in range(s.size()):
				if offset + i >= 0 and offset + i < dst.size():
					dst[offset + i] = s[i]
		return null
	return invoke(get_prop(target, "set"), args)

static func flat_map(target: Variant, cb: Callable) -> Variant:
	if target is Dictionary and (target as Dictionary).has("flatMap"):
		return invoke((target as Dictionary)["flatMap"], [cb])
	var arr := target as Array
	var out: Array = []
	for i in range(arr.size()):
		var res = _call_cb(cb, arr[i], i, arr)
		if res is Array:
			out.append_array(res as Array)
		else:
			out.append(res)
	return out

static func typed_array(arg: Variant = 0) -> Array:
	if arg is Array:
		return (arg as Array).duplicate()
	var n := int(arg)
	var out: Array = []
	out.resize(maxi(0, n))
	out.fill(0.0)
	return out

static func json_parse(s: Variant) -> Variant:
	if s == null:
		return null
	return JSON.parse_string(str(s))

static func arr_from(iterable: Variant, mapper: Variant = null) -> Array:
	var out: Array = []
	if iterable is Array:
		out = (iterable as Array).duplicate()
	elif iterable is Dictionary:
		var d := iterable as Dictionary
		if d.has("__is_set"):
			out = (d["__store"] as Dictionary).keys()
		elif d.has("__is_map"):
			out = obj_entries(d["__store"] as Dictionary)
		elif d.has("length"):
			var n := maxi(0, int(num(d["length"])))
			for i in range(n):
				out.append(get_prop(d, i))
		else:
			for k in d.keys():
				out.append(k)
	elif iterable is String:
		var s := iterable as String
		for i in range(s.length()):
			out.append(s.substr(i, 1))
	if mapper is Callable:
		return map(out, mapper as Callable)
	return out

static func reverse_arr(target: Variant) -> Variant:
	if target is Dictionary and (target as Dictionary).has("reverse"):
		return invoke((target as Dictionary)["reverse"], [])
	if target is Array:
		(target as Array).reverse()
	return target

static func make_map(init: Variant = null) -> Dictionary:
	var store: Dictionary = {}
	if init != null:
		for pair in iter(init):
			if pair is Array and (pair as Array).size() >= 2:
				store[pair[0]] = pair[1]
	return { "__is_map": true, "__store": store }

static func make_set(init: Variant = null) -> Dictionary:
	var store: Dictionary = {}
	if init != null:
		for item in iter(init):
			store[item] = true
	return { "__is_set": true, "__store": store }
