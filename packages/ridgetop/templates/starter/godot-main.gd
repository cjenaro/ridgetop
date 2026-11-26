extends Node3D

# Lantern Grove / Ridgetop Starter — Godot 4 grid game host.
# Delegates scene/lighting/audio/assets to RidgetopRuntime (res://scripts/ridgetop_runtime.gd)
# and renders custom low-poly CanvasItem UI via res://scripts/ridgetop_ui.gd.

const RidgetopRuntime = preload("res://scripts/ridgetop_runtime.gd")

var runtime: RidgetopRuntime = null
var game_data: Dictionary = {}
var ui: Control = null
var world_env: WorldEnvironment = null
var camera: Camera3D = null
var directional_light: DirectionalLight3D = null

var map_rows: Array = []
var map_w: int = 0
var map_h: int = 0
var solid_cells: Dictionary = {}
var pickup_nodes: Dictionary = {}
var player_node: Node3D
var player_pos := Vector2i.ZERO
var from_world := Vector3.ZERO
var to_world := Vector3.ZERO
var spawn_pos := Vector2i.ZERO
var goal_pos := Vector2i.ZERO
var total_pickups: int = 0
var step_seconds: float = 0.16
var travel: float = 0.0
var grid_won: bool = false
var grid_paused: bool = false

func _ready() -> void:
	world_env = get_node_or_null("WorldEnvironment") as WorldEnvironment
	camera = get_node_or_null("Camera3D") as Camera3D
	directional_light = get_node_or_null("DirectionalLight3D") as DirectionalLight3D
	ui = get_node_or_null("UI") as Control

	runtime = RidgetopRuntime.new()
	runtime.name = "RidgetopRuntime"
	add_child(runtime)
	runtime.setup(self, camera, directional_light, world_env, ui)
	camera = runtime.camera
	world_env = runtime.world_env
	directional_light = runtime.directional_light

	if ui:
		ui.action_triggered.connect(_on_ui_action)
		ui.back_pressed.connect(_on_ui_back)

	var raw := FileAccess.get_file_as_string("res://data/game.json")
	if raw != "":
		var parsed = JSON.parse_string(raw)
		if typeof(parsed) == TYPE_DICTIONARY:
			game_data = parsed

	if ui and game_data.has("theme") and typeof(game_data["theme"]) == TYPE_DICTIONARY:
		ui.apply_theme(game_data["theme"])
	elif ui and game_data.has("palette") and typeof(game_data["palette"]) == TYPE_DICTIONARY:
		var pal: Dictionary = game_data["palette"]
		if pal.has("accent"):
			ui.apply_theme({ "accent": str(pal["accent"]), "glow": str(pal.get("glow", "#83f0d6")) })

	if game_data.has("clear") or game_data.has("clearColor"):
		runtime.set_clear_color(game_data.get("clear", game_data.get("clearColor")))
	if game_data.has("lighting") and game_data["lighting"] is Dictionary:
		runtime.set_lighting(game_data["lighting"] as Dictionary)
	if game_data.has("ambience") and game_data["ambience"] is Dictionary:
		var beds_cfg: Dictionary = game_data["ambience"] as Dictionary
		for bed_id in beds_cfg.keys():
			if beds_cfg[bed_id] is Dictionary:
				runtime.register_ambient_bed(str(bed_id), beds_cfg[bed_id] as Dictionary)

	get_viewport().size_changed.connect(_rebuild_ui)

	if game_data.has("map") and typeof(game_data["map"]) == TYPE_ARRAY and (game_data["map"] as Array).size() > 0:
		_setup_grid_game(game_data["map"])
	_rebuild_ui()

func _exit_tree() -> void:
	if runtime and is_instance_valid(runtime):
		runtime.cleanup()

func _spawn_model(model_name: String, pos: Vector3, parent: Node = self) -> Node3D:
	return runtime.spawn_model(model_name, pos, parent)

func _play_sfx(clip_name: String, volume: float = 1.0, pitch: float = 1.0) -> void:
	runtime.play_sfx(clip_name, volume, pitch)

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("action_pause"):
		_toggle_pause()
		get_viewport().set_input_as_handled()
		return
	if ui and (grid_paused or grid_won):
		if ui.handle_menu_input(event):
			get_viewport().set_input_as_handled()

func _toggle_pause() -> void:
	if not grid_won:
		grid_paused = not grid_paused
	_rebuild_ui()

func _on_ui_back() -> void:
	_toggle_pause()

func _on_ui_action(id: String) -> void:
	if id == "sound":
		runtime.set_muted(not runtime.is_muted())
		_rebuild_ui()
		return
	if id == "quit":
		get_tree().quit()
		return
	if id == "menu":
		grid_paused = not grid_paused
	elif id == "resume":
		grid_paused = false
	elif id == "restart":
		grid_paused = false
		_restart_grid()
	_rebuild_ui()

func _setup_grid_game(rows: Array) -> void:
	map_rows = rows
	map_h = rows.size()
	map_w = str(rows[0]).length()
	step_seconds = float(game_data.get("stepSeconds", 0.16))
	var ground_role := str(game_data.get("ground", "tile"))
	var goal_role := str(game_data.get("goal", "lantern"))
	var scenery: Dictionary = game_data.get("scenery", {})

	var world := Node3D.new()
	world.name = "World"
	add_child(world)

	for z in range(map_h):
		var line := str(rows[z])
		for x in range(map_w):
			var ch := line.substr(x, 1)
			_spawn_model(ground_role, Vector3(x, 0, z), world)
			if ch == "@":
				spawn_pos = Vector2i(x, z)
			elif ch == "L":
				goal_pos = Vector2i(x, z)
				_spawn_model(goal_role, Vector3(x, 0, z), world)
			elif scenery.has(ch):
				solid_cells[Vector2i(x, z)] = true
				_spawn_model(str(scenery[ch]), Vector3(x, 0, z), world)

	var cx := float(map_w - 1) * 0.5
	var cz := float(map_h - 1) * 0.5
	var dist := maxf(float(map_w), float(map_h)) * 2.0 + 8.0
	runtime.set_camera({
		"projection": "orthographic",
		"size": maxf(float(map_h) * 0.5 + 3.8, (float(map_w) + 2.0) * 0.62),
		"position": Vector3(cx, 0.5 + dist * 0.5, cz + dist * cos(PI / 6.0)),
		"target": Vector3(cx, 0.5, cz)
	})

	player_node = _spawn_model(str(game_data.get("player", "ranger")), Vector3.ZERO)
	_restart_grid()

func _restart_grid() -> void:
	for node in pickup_nodes.values():
		if is_instance_valid(node):
			node.queue_free()
	pickup_nodes.clear()
	var pickup_role := str(game_data.get("pickup", "crystal"))
	for z in range(map_h):
		var line := str(map_rows[z])
		for x in range(map_w):
			if line.substr(x, 1) == "*":
				var p := _spawn_model(pickup_role, Vector3(x, 0, z))
				if p:
					pickup_nodes[Vector2i(x, z)] = p
	total_pickups = pickup_nodes.size()
	player_pos = spawn_pos
	from_world = Vector3(player_pos.x, 0, player_pos.y)
	to_world = from_world
	travel = 0.0
	grid_won = false
	if player_node:
		player_node.position = from_world
	_rebuild_ui()

func _process(delta: float) -> void:
	if grid_paused or grid_won or map_rows.is_empty():
		return
	if travel > 0.0:
		travel = maxf(0.0, travel - delta)
		var u := 1.0 - (travel / maxf(0.001, step_seconds))
		if player_node:
			var pos := from_world.lerp(to_world, u)
			pos.y = 0.08 * sin(PI * u)
			player_node.position = pos
		if travel == 0.0:
			_arrive_cell()
		return

	var dir := Vector2i.ZERO
	if Input.is_action_pressed("move_left"):
		dir = Vector2i(-1, 0)
	elif Input.is_action_pressed("move_right"):
		dir = Vector2i(1, 0)
	elif Input.is_action_pressed("move_up"):
		dir = Vector2i(0, -1)
	elif Input.is_action_pressed("move_down"):
		dir = Vector2i(0, 1)
	if dir == Vector2i.ZERO:
		return

	if player_node:
		player_node.rotation.y = atan2(float(dir.x), float(dir.y))
	var next_cell := player_pos + dir
	if next_cell.x < 0 or next_cell.x >= map_w or next_cell.y < 0 or next_cell.y >= map_h or solid_cells.has(next_cell):
		return
	from_world = Vector3(player_pos.x, 0, player_pos.y)
	player_pos = next_cell
	to_world = Vector3(player_pos.x, 0, player_pos.y)
	travel = step_seconds

func _arrive_cell() -> void:
	if pickup_nodes.has(player_pos):
		var node = pickup_nodes[player_pos]
		if is_instance_valid(node):
			node.queue_free()
		pickup_nodes.erase(player_pos)
		_play_sfx("pickup")
		_rebuild_ui()
	if pickup_nodes.is_empty() and player_pos == goal_pos:
		grid_won = true
		_play_sfx("victory")
		_rebuild_ui()

func _rebuild_ui() -> void:
	if ui == null:
		return
	var vp := get_viewport().get_visible_rect().size
	var w := vp.x
	var h := vp.y
	var items: Array = []
	var sound_on := not runtime.is_muted()
	var game_title := str(game_data.get("name", "Lantern Grove"))
	var found := total_pickups - pickup_nodes.size()
	var msg := str(game_data.get("victory", "Complete!")) if grid_won else (str(game_data.get("objective", "Collect all pickups.")) if pickup_nodes.size() > 0 else str(game_data.get("returnToGoal", "Reach the goal.")))
	var bar_w := minf(w - 32.0, 920.0)
	var bx := (w - bar_w) * 0.5
	items.append({ "type": "panel", "rect": Rect2(bx, 16, 92, 44) })
	items.append({ "type": "text", "rect": Rect2(bx, 16, 92, 44), "text": "%d / %d" % [found, total_pickups], "size": 16, "align": "center", "color": Color("#83f0d6") })
	items.append({ "type": "panel", "rect": Rect2(bx + 102, 16, bar_w - 196, 44) })
	items.append({ "type": "text", "rect": Rect2(bx + 116, 16, bar_w - 224, 44), "text": "%s  —  %s" % [game_title, msg], "size": 14 })
	items.append({ "type": "button", "id": "menu", "rect": Rect2(bx + bar_w - 84, 16, 84, 44), "label": "Menu" })

	if grid_paused or grid_won:
		items.append({ "type": "scrim", "rect": Rect2(0, 0, w, h) })
		var cw := 340.0
		var ch := 280.0
		var mx := (w - cw) * 0.5
		var my := (h - ch) * 0.5
		items.append({ "type": "panel", "rect": Rect2(mx, my, cw, ch) })
		items.append({ "type": "text", "rect": Rect2(mx + 20, my + 20, cw - 40, 32), "text": msg if grid_won else game_title, "size": 22, "align": "center" })
		var y := my + 72.0
		if not grid_won:
			items.append({ "type": "button", "id": "resume", "rect": Rect2(mx + 24, y, cw - 48, 42), "label": "Resume", "primary": true })
			y += 50.0
		items.append({ "type": "button", "id": "restart", "rect": Rect2(mx + 24, y, cw - 48, 42), "label": "Play Again" if grid_won else "Restart", "primary": grid_won })
		y += 50.0
		items.append({ "type": "toggle", "id": "sound", "rect": Rect2(mx + 24, y, cw - 48, 40), "label": "Sound", "checked": sound_on })
		y += 48.0
		items.append({ "type": "button", "id": "quit", "rect": Rect2(mx + 24, y, cw - 48, 38), "label": "Quit" })

	ui.set_items(items)
