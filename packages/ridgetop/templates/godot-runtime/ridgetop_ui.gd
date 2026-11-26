extends Control

# Custom Ridgetop Canvas UI renderer for Godot 4 (zero default Godot widgets).
# Draws the same low-poly chamfered faceted panels, accent buttons, toggles, and HUD cards
# as framework/ui-canvas.ts directly inside CanvasItem._draw().

signal action_triggered(id: String)
signal back_pressed()

var items: Array = []
var theme_cfg: Dictionary = {
	"surface": Color("#16282ceb"),
	"surfaceAlt": Color("#213a3ff2"),
	"top": Color("#35575c88"),
	"border": Color("#63867f99"),
	"accent": Color("#efac62"),
	"accentText": Color("#162326"),
	"text": Color("#f3f6e4"),
	"muted": Color("#bcd2c8"),
	"glow": Color("#83f0d6"),
	"scrim": Color("#0b161bc4")
}

var hovered_id: String = ""
var focused_id: String = ""
var pressed_id: String = ""
var _font: Font

func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_PASS
	_font = ThemeDB.fallback_font

func apply_theme(cfg: Dictionary) -> void:
	for key in cfg.keys():
		var val = cfg[key]
		if val is String:
			theme_cfg[key] = Color(val)
		elif val is Color:
			theme_cfg[key] = val
	queue_redraw()

func set_items(next_items: Array) -> void:
	items = next_items
	var focusables := _focusable_items()
	if focusables.is_empty():
		focused_id = ""
	elif not _has_focusable(focused_id):
		focused_id = str(focusables[0].get("id", ""))
	if hovered_id != "" and not _has_focusable(hovered_id):
		hovered_id = ""
		mouse_default_cursor_shape = Control.CURSOR_ARROW
	if pressed_id != "" and not _has_focusable(pressed_id):
		pressed_id = ""
	queue_redraw()

func _focusable_items() -> Array:
	var out: Array = []
	for item in items:
		var t := str(item.get("type", ""))
		if (t == "button" or t == "toggle") and not bool(item.get("disabled", false)):
			out.append(item)
	return out

func _has_focusable(id: String) -> bool:
	if id == "":
		return false
	for item in _focusable_items():
		if str(item.get("id", "")) == id:
			return true
	return false

func _hit_test(pos: Vector2) -> Dictionary:
	for i in range(items.size() - 1, -1, -1):
		var item: Dictionary = items[i]
		var t := str(item.get("type", ""))
		if (t == "button" or t == "toggle") and not bool(item.get("disabled", false)):
			var r: Rect2 = item.get("rect", Rect2())
			if r.has_point(pos):
				return item
	return {}

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion:
		var hit := _hit_test(event.position)
		var next_hover := str(hit.get("id", ""))
		if next_hover != hovered_id:
			hovered_id = next_hover
			mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND if hovered_id != "" else Control.CURSOR_ARROW
			queue_redraw()
	elif event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		var hit := _hit_test(event.position)
		if event.pressed:
			if not hit.is_empty():
				pressed_id = str(hit.get("id", ""))
				focused_id = pressed_id
				accept_event()
				queue_redraw()
		else:
			if pressed_id != "":
				var target := pressed_id
				pressed_id = ""
				if not hit.is_empty() and str(hit.get("id", "")) == target:
					action_triggered.emit(target)
				accept_event()
				queue_redraw()

func handle_menu_input(event: InputEvent) -> bool:
	var focusables := _focusable_items()
	if focusables.is_empty():
		return false
	if event.is_action_pressed("action_cancel"):
		back_pressed.emit()
		return true
	if event.is_action_pressed("move_down") or event.is_action_pressed("move_right"):
		_move_focus(1)
		return true
	if event.is_action_pressed("move_up") or event.is_action_pressed("move_left"):
		_move_focus(-1)
		return true
	if event.is_action_pressed("action_confirm"):
		var id := focused_id if _has_focusable(focused_id) else str(focusables[0].get("id", ""))
		if id != "":
			action_triggered.emit(id)
			return true
	return false

func _move_focus(delta: int) -> void:
	var focusables := _focusable_items()
	if focusables.is_empty():
		return
	var idx := -1
	for i in range(focusables.size()):
		if str(focusables[i].get("id", "")) == focused_id:
			idx = i
			break
	var next_idx := (idx + delta + focusables.size()) % focusables.size() if idx >= 0 else (0 if delta > 0 else focusables.size() - 1)
	focused_id = str(focusables[next_idx].get("id", ""))
	queue_redraw()

func _chamfer_points(rect: Rect2, bevel: float) -> PackedVector2Array:
	var b := minf(bevel, minf(rect.size.x / 3.0, rect.size.y / 3.0))
	var x := rect.position.x
	var y := rect.position.y
	var w := rect.size.x
	var h := rect.size.y
	return PackedVector2Array([
		Vector2(x + b, y), Vector2(x + w - b, y),
		Vector2(x + w, y + b), Vector2(x + w, y + h - b),
		Vector2(x + w - b, y + h), Vector2(x + b, y + h),
		Vector2(x, y + h - b), Vector2(x, y + b)
	])

func _draw_faceted(rect: Rect2, fill: Color, stroke: Color, highlight: Color, bevel: float = 7.0) -> void:
	if rect.size.x <= 0.0 or rect.size.y <= 0.0:
		return
	var pts := _chamfer_points(rect, bevel)
	draw_colored_polygon(pts, fill)
	if highlight.a > 0.01 and rect.size.y >= 16.0:
		var b := minf(bevel, rect.size.x / 3.0)
		var top_h := maxf(2.0, rect.size.y * 0.14)
		draw_rect(Rect2(rect.position.x + b * 0.7, rect.position.y + 1.0, maxf(1.0, rect.size.x - b * 1.4), top_h), highlight)
	var outline := pts.duplicate()
	outline.append(pts[0])
	draw_polyline(outline, stroke, 1.5, true)

func _draw() -> void:
	var surface: Color = theme_cfg["surface"]
	var surface_alt: Color = theme_cfg["surfaceAlt"]
	var top_hi: Color = theme_cfg["top"]
	var border: Color = theme_cfg["border"]
	var accent: Color = theme_cfg["accent"]
	var accent_text: Color = theme_cfg["accentText"]
	var text_col: Color = theme_cfg["text"]
	var muted_col: Color = theme_cfg["muted"]
	var scrim_col: Color = theme_cfg["scrim"]

	for item in items:
		var t := str(item.get("type", ""))
		var rect: Rect2 = item.get("rect", Rect2())
		if t == "scrim":
			draw_rect(rect, item.get("fill", scrim_col))
		elif t == "panel":
			_draw_faceted(rect, item.get("fill", surface), item.get("stroke", border), top_hi, float(item.get("bevel", 7.0)))
		elif t == "bar":
			var ratio := clampf(float(item.get("ratio", 0.0)), 0.0, 1.0)
			draw_rect(rect, item.get("bg", Color("#4a342c")))
			if ratio > 0.0:
				draw_rect(Rect2(rect.position, Vector2(rect.size.x * ratio, rect.size.y)), item.get("fill", theme_cfg["glow"]))
		elif t == "text":
			var txt := str(item.get("text", ""))
			var fsize := int(item.get("size", 15))
			var col: Color = item.get("color", text_col)
			var align := str(item.get("align", "left"))
			var ha := HORIZONTAL_ALIGNMENT_CENTER if align == "center" else (HORIZONTAL_ALIGNMENT_RIGHT if align == "right" else HORIZONTAL_ALIGNMENT_LEFT)
			var baseline_y := rect.position.y + rect.size.y * 0.5 + fsize * 0.34
			draw_string(_font, Vector2(rect.position.x, baseline_y), txt, ha, rect.size.x, fsize, col)
		elif t == "button" or t == "toggle":
			var id := str(item.get("id", ""))
			var disabled := bool(item.get("disabled", false))
			var is_hover := (not disabled) and hovered_id == id
			var is_focus := (not disabled) and focused_id == id
			var is_press := (not disabled) and pressed_id == id
			var primary := bool(item.get("primary", false)) if t == "button" else bool(item.get("checked", false))
			var fill := Color("#161d20aa") if disabled else (accent if primary else (top_hi if is_press else (surface_alt if is_hover else surface)))
			var stroke := Color("#404d5055") if disabled else (accent if (is_focus or is_hover) else border)
			var hi := Color(1, 1, 1, 0.20) if primary else top_hi
			var draw_rect_box := Rect2(rect.position + Vector2(0, 1.5 if is_press else 0.0), rect.size)
			_draw_faceted(draw_rect_box, fill, stroke, hi, 7.0)
			var label := str(item.get("label", ""))
			if t == "toggle":
				label = "%s: %s" % [label, "ON" if bool(item.get("checked", false)) else "OFF"]
			var subtitle := str(item.get("subtitle", ""))
			var label_col := accent_text if primary else (muted_col if disabled else text_col)
			if subtitle != "":
				draw_string(_font, Vector2(draw_rect_box.position.x + 14.0, draw_rect_box.position.y + draw_rect_box.size.y * 0.42), label, HORIZONTAL_ALIGNMENT_LEFT, draw_rect_box.size.x - 28.0, 15, label_col)
				draw_string(_font, Vector2(draw_rect_box.position.x + 14.0, draw_rect_box.position.y + draw_rect_box.size.y * 0.78), subtitle, HORIZONTAL_ALIGNMENT_LEFT, draw_rect_box.size.x - 28.0, 11, accent_text if primary else muted_col)
			else:
				var fsize := int(item.get("size", 15))
				draw_string(_font, Vector2(draw_rect_box.position.x, draw_rect_box.position.y + draw_rect_box.size.y * 0.5 + fsize * 0.34), label, HORIZONTAL_ALIGNMENT_CENTER, draw_rect_box.size.x, fsize, label_col)
