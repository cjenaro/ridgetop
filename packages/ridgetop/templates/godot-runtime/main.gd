extends Node3D

# Auto-generated generic Ridgetop -> Godot 4 runtime host.
# Delegates scene/lighting/batches/rigs/particles/audio/assets to RidgetopRuntime
# (res://scripts/ridgetop_runtime.gd), executes compiled TypeScript modules from
# res://scripts/compiled/, and renders custom low-poly CanvasItem UI (res://scripts/ridgetop_ui.gd).
# Projects that need bespoke Godot scene/HUD logic can supply their own mainScript / godotMain file.

const RidgetopRuntime = preload("res://scripts/ridgetop_runtime.gd")

var runtime: RidgetopRuntime = null
var game_data: Dictionary = {}
var ui: Control = null
var world_env: WorldEnvironment = null
var camera: Camera3D = null
var directional_light: DirectionalLight3D = null

var generic_mod: Object = null
var compiled_modules: Array[String] = []
var generic_root: Node3D = null
var generic_rigs: Array = []
var generic_menu_open: bool = true
var generic_spin_stage: bool = true

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

	get_viewport().size_changed.connect(_on_viewport_resized)
	compiled_modules = runtime.list_compiled_modules()
	_setup_generic_game()
	_rebuild_ui()

func _on_viewport_resized() -> void:
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
	if ui and generic_menu_open:
		if ui.handle_menu_input(event):
			get_viewport().set_input_as_handled()

func _toggle_pause() -> void:
	generic_menu_open = not generic_menu_open
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

	if generic_mod != null:
		if generic_mod.has_method("on_action"):
			generic_mod.on_action(id, runtime)
		elif generic_mod.has_method("onAction"):
			generic_mod.onAction(id, runtime)

	if id == "close-menu":
		generic_menu_open = false
	elif id == "open-menu":
		generic_menu_open = true
	elif id == "test-sfx":
		var clips: Array = game_data.get("audio", [])
		if clips.size() > 0:
			_play_sfx(str(clips[0]))
	else:
		var clips: Array = game_data.get("audio", [])
		if clips.size() > 0:
			_play_sfx(str(clips[0]))
	_rebuild_ui()

func _setup_generic_game() -> void:
	generic_root = Node3D.new()
	generic_root.name = "GenericSceneRoot"
	add_child(generic_root)

	var entry_path := str(game_data.get("entry", game_data.get("runtimeModule", "")))
	if entry_path != "":
		generic_mod = runtime.load_compiled_module(entry_path)

	if game_data.has("scene") and game_data["scene"] is Array:
		generic_spin_stage = false
		for ent_val in game_data["scene"] as Array:
			if not (ent_val is Dictionary):
				continue
			var ent: Dictionary = ent_val as Dictionary
			var pos := runtime._to_vec3(ent.get("position", Vector3.ZERO), Vector3.ZERO)
			var node := _spawn_model(str(ent.get("model", "")), pos, generic_root)
			if node:
				if ent.has("rotation"):
					node.quaternion = RidgetopRuntime.InstancedBatch._coerce_quat(ent["rotation"])
				elif ent.has("yaw"):
					node.rotation.y = float(ent["yaw"])
				if ent.has("scale"):
					node.scale = runtime._to_scale_vec3(ent["scale"], Vector3.ONE)
	else:
		var names: Array = game_data.get("models", [])
		for i in range(names.size()):
			var x_off := (float(i) - float(names.size() - 1) * 0.5) * 2.4
			_spawn_model(str(names[i]), Vector3(x_off, 0.0, 0.0), generic_root)

	if game_data.has("rigs") and game_data["rigs"] is Array:
		for rig_val in game_data["rigs"] as Array:
			if not (rig_val is Dictionary):
				continue
			var rig_cfg: Dictionary = rig_val as Dictionary
			var joints_val = rig_cfg.get("joints", [])
			if joints_val is Array:
				var rig := runtime.create_rig(joints_val as Array, generic_root)
				var poses: Dictionary = rig_cfg.get("poses", {}) if rig_cfg.get("poses", null) is Dictionary else {}
				rig.apply_poses(poses, rig_cfg)
				generic_rigs.append(rig)

	if game_data.has("camera") and game_data["camera"] is Dictionary:
		runtime.set_camera(game_data["camera"] as Dictionary)
	else:
		runtime.set_camera({
			"projection": "perspective",
			"position": Vector3(-1.0, 2.4, 5.2),
			"target": Vector3(-0.3, 0.5, 0.0)
		})

	if generic_mod != null:
		generic_spin_stage = false
		if generic_mod.has_method("init_game"):
			generic_mod.init_game(runtime, game_data)
		elif generic_mod.has_method("initGame"):
			generic_mod.initGame(runtime, game_data)

func _sample_generic_input() -> Dictionary:
	return {
		"x": Input.get_axis("move_left", "move_right"),
		"z": Input.get_axis("move_up", "move_down"),
		"confirm": Input.is_action_pressed("action_confirm"),
		"cancel": Input.is_action_pressed("action_cancel")
	}

func _process(delta: float) -> void:
	if generic_mod != null:
		var inp := _sample_generic_input()
		if generic_mod.has_method("step_game"):
			generic_mod.step_game(delta, inp, runtime)
		elif generic_mod.has_method("stepGame"):
			generic_mod.stepGame(delta, inp, runtime)
		_rebuild_ui()
	elif generic_root and generic_spin_stage:
		generic_root.rotate_y(delta * 0.55)

func _rebuild_ui() -> void:
	if ui == null:
		return
	var vp := get_viewport().get_visible_rect().size
	var w := vp.x
	var items: Array = []
	var sound_on := not runtime.is_muted()
	var custom_items: Variant = null
	if generic_mod != null:
		if generic_mod.has_method("build_ui"):
			custom_items = generic_mod.build_ui(vp, runtime)
		elif generic_mod.has_method("buildUi"):
			custom_items = generic_mod.buildUi(vp, runtime)
	if custom_items is Array:
		items = custom_items as Array
	elif generic_menu_open:
		var clips: Array = game_data.get("audio", [])
		var has_audio := clips.size() > 0
		var panel_h := 288.0 if has_audio else 240.0
		items.append({ "type": "panel", "rect": Rect2(36, 36, 320, panel_h) })
		items.append({ "type": "text", "rect": Rect2(56, 56, 280, 34), "text": str(game_data.get("name", "__GAME_NAME__")).to_upper(), "size": 24, "align": "center" })
		var gy := 104.0
		items.append({ "type": "button", "id": "close-menu", "rect": Rect2(56, gy, 280, 42), "label": "Inspect 3D Scene", "primary": true })
		gy += 50.0
		if has_audio:
			items.append({ "type": "button", "id": "test-sfx", "rect": Rect2(56, gy, 280, 40), "label": "Test Audio" })
			gy += 48.0
		items.append({ "type": "toggle", "id": "sound", "rect": Rect2(56, gy, 280, 40), "label": "Sound", "checked": sound_on })
		gy += 48.0
		items.append({ "type": "button", "id": "quit", "rect": Rect2(56, gy, 280, 40), "label": "Quit" })
	else:
		items.append({ "type": "button", "id": "open-menu", "rect": Rect2(w - 102, 18, 84, 40), "label": "Menu" })

	ui.set_items(items)
