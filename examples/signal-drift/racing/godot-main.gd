extends Node3D

# Signal Drift — Godot 4 thin view host over compiled racing/race.ts (zero duplicated physics).
# Delegates scene/lighting/audio/assets to RidgetopRuntime (res://scripts/ridgetop_runtime.gd)
# and renders custom low-poly CanvasItem UI via res://scripts/ridgetop_ui.gd.

const RidgetopRuntime = preload("res://scripts/ridgetop_runtime.gd")

var runtime: RidgetopRuntime = null
var game_data: Dictionary = {}
var ui: Control = null
var world_env: WorldEnvironment = null
var camera: Camera3D = null
var directional_light: DirectionalLight3D = null
var _last_ui_key: String = ""

var race_mod: Object = null
var track_mod: Object = null
var prog_mod: Object = null

var circuits: Array = []
var circuit_index: int = 0
var race_screen: String = "home" # "home" | "events" | "racing" | "paused" | "results"
var track_root: Node3D
var fx_root: Node3D
var car_nodes: Array = []
var race_state: Dictionary = {}
var championship: Dictionary = {}
var race_countdown: float = 0.0
var race_accum: float = 0.0
var race_result: Dictionary = {}
var queued_pulse: bool = false
var queued_snare: bool = false
var _pulse_mesh: SphereMesh
var _snare_mesh: CylinderMesh
var _supply_mesh: BoxMesh
var _pulse_mat: StandardMaterial3D
var _snare_mat: StandardMaterial3D
var _supply_mat: StandardMaterial3D
var _hit_mat: StandardMaterial3D
var _supply_pool: Array[MeshInstance3D] = []
var _pulse_pool: Array[MeshInstance3D] = []
var _snare_pool: Array[MeshInstance3D] = []
var _hit_pool: Array[MeshInstance3D] = []

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

	if game_data.has("circuits") and typeof(game_data["circuits"]) == TYPE_ARRAY:
		circuits = game_data["circuits"]
	_init_fx_meshes()
	if runtime.rt_script and ResourceLoader.exists("res://scripts/compiled/racing/race.gd"):
		race_mod = runtime.load_compiled_module("racing/race.gd")
		track_mod = runtime.load_compiled_module("racing/track.gd")
		prog_mod = runtime.load_compiled_module("racing/progression.gd")
		championship = prog_mod.loadChampionship(runtime.storage)
	if circuits.size() > 0:
		_load_circuit(0)
	_rebuild_ui()

func _on_viewport_resized() -> void:
	_last_ui_key = ""
	_rebuild_ui()

func _exit_tree() -> void:
	if runtime and is_instance_valid(runtime):
		runtime.cleanup()

func _init_fx_meshes() -> void:
	_pulse_mesh = SphereMesh.new()
	_pulse_mesh.radius = 0.42
	_pulse_mesh.height = 0.84
	_snare_mesh = CylinderMesh.new()
	_snare_mesh.top_radius = 0.65
	_snare_mesh.bottom_radius = 0.78
	_snare_mesh.height = 0.35
	_supply_mesh = BoxMesh.new()
	_supply_mesh.size = Vector3(0.95, 0.95, 0.95)
	_pulse_mat = StandardMaterial3D.new()
	_pulse_mat.albedo_color = Color("#7bf9e8")
	_pulse_mat.emission_enabled = true
	_pulse_mat.emission = Color("#7bf9e8")
	_pulse_mat.emission_energy_multiplier = 1.4
	_snare_mat = StandardMaterial3D.new()
	_snare_mat.albedo_color = Color("#ffaf68")
	_snare_mat.emission_enabled = true
	_snare_mat.emission = Color("#ffaf68")
	_supply_mat = StandardMaterial3D.new()
	_supply_mat.albedo_color = Color("#8df5d5")
	_supply_mat.emission_enabled = true
	_supply_mat.emission = Color("#56bfae")
	_hit_mat = StandardMaterial3D.new()
	_hit_mat.albedo_color = Color("#ffdcaa")
	_hit_mat.emission_enabled = true
	_hit_mat.emission = Color("#ffdcaa")
	_hit_mat.emission_energy_multiplier = 1.8

func _spawn_model(model_name: String, pos: Vector3, parent: Node = self) -> Node3D:
	return runtime.spawn_model(model_name, pos, parent)

func _play_sfx(clip_name: String, volume: float = 1.0, pitch: float = 1.0) -> void:
	runtime.play_sfx(clip_name, volume, pitch)

func _input(event: InputEvent) -> void:
	if event.is_action_pressed("action_pause"):
		_toggle_pause()
		get_viewport().set_input_as_handled()
		return
	if race_screen == "racing":
		if event is InputEventKey and event.pressed and not event.echo:
			var ke := event as InputEventKey
			if ke.physical_keycode == KEY_J and race_countdown <= 0.0:
				queued_pulse = true
			elif ke.physical_keycode == KEY_K and race_countdown <= 0.0:
				queued_snare = true
			elif ke.physical_keycode == KEY_R:
				_recover_player()
		elif event is InputEventJoypadButton and event.pressed:
			var jb := event as InputEventJoypadButton
			if (jb.button_index == JOY_BUTTON_RIGHT_SHOULDER or jb.button_index == JOY_BUTTON_X) and race_countdown <= 0.0:
				queued_pulse = true
			elif jb.button_index == JOY_BUTTON_Y and race_countdown <= 0.0:
				queued_snare = true
			elif jb.button_index == JOY_BUTTON_BACK:
				_recover_player()
		return
	if ui and race_screen != "racing":
		if ui.handle_menu_input(event):
			get_viewport().set_input_as_handled()

func _toggle_pause() -> void:
	if race_screen == "racing":
		race_screen = "paused"
	elif race_screen == "paused":
		race_screen = "racing"
	elif race_screen == "events" or race_screen == "results":
		race_screen = "home"
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
	if id == "race-start":
		if race_screen == "paused":
			race_screen = "racing"
		else:
			_start_race(circuit_index)
	elif id == "race-events":
		race_screen = "events"
	elif id == "race-restart":
		_start_race(circuit_index)
	elif id == "race-home":
		race_screen = "home"
	elif id == "race-pause":
		race_screen = "paused"
	elif id == "race-recover":
		_recover_player()
	elif id == "race-next" and circuits.size() > 0:
		_start_race((circuit_index + 1) % circuits.size())
	elif id.begins_with("event-"):
		var idx := int(id.trim_prefix("event-"))
		_start_race(idx)
	_rebuild_ui()

func _load_circuit(index: int) -> void:
	circuit_index = clampi(index, 0, circuits.size() - 1)
	if track_root and is_instance_valid(track_root):
		track_root.queue_free()
	_supply_pool.clear()
	_pulse_pool.clear()
	_snare_pool.clear()
	_hit_pool.clear()
	track_root = Node3D.new()
	track_root.name = "CircuitRoot"
	add_child(track_root)
	fx_root = Node3D.new()
	fx_root.name = "FxRoot"
	track_root.add_child(fx_root)

	var c: Dictionary = circuits[circuit_index]
	_spawn_model("circuit-%s" % str(c["id"]), Vector3.ZERO, track_root)
	if c.has("clear"):
		runtime.set_clear_color(c["clear"])

	car_nodes.clear()
	queued_pulse = false
	queued_snare = false
	race_accum = 0.0
	if race_mod and track_mod:
		var ts_circuit = track_mod.circuits[circuit_index]
		var build = championship.get("build", prog_mod.stock) if prog_mod else null
		race_state = race_mod.createRace(ts_circuit, build)
		var ts_drivers: Array = race_state["drivers"]
		for slot in range(ts_drivers.size()):
			var d: Dictionary = ts_drivers[slot]
			var car := _spawn_model("car-%d" % slot, Vector3(float(d["x"]), 0.0, float(d["z"])), track_root)
			if car:
				car.rotation.y = float(d["yaw"])
				if slot == 0:
					var beacon := MeshInstance3D.new()
					beacon.mesh = _pulse_mesh
					beacon.material_override = _hit_mat
					beacon.scale = Vector3(0.55, 0.45, 0.55)
					beacon.position = Vector3(0.0, 1.85, 0.0)
					car.add_child(beacon)
			car_nodes.append(car)
		_sync_race_fx()
	_update_race_camera(false)

func _start_race(index: int) -> void:
	_load_circuit(index)
	race_countdown = 2.4
	race_result = {}
	race_screen = "racing"
	_rebuild_ui()

func _recover_player() -> void:
	if race_mod and not race_state.is_empty() and race_countdown <= 0.0:
		race_mod.recover(race_state["drivers"][0], race_state["circuit"])

func _driver_place(slot: int) -> int:
	if race_mod == null or race_state.is_empty():
		return 1
	var order: Array = race_mod.standings(race_state)
	for i in range(order.size()):
		if int(order[i]["slot"]) == slot:
			return i + 1
	return 1

func _acquire_fx(pool: Array[MeshInstance3D], index: int, mesh: Mesh, mat: Material) -> MeshInstance3D:
	while pool.size() <= index:
		var m := MeshInstance3D.new()
		m.mesh = mesh
		m.material_override = mat
		fx_root.add_child(m)
		pool.append(m)
	var node: MeshInstance3D = pool[index]
	node.visible = true
	return node

func _hide_unused_fx(pool: Array[MeshInstance3D], used: int) -> void:
	for i in range(used, pool.size()):
		pool[i].visible = false

func _sync_race_fx() -> void:
	if fx_root == null or race_state.is_empty():
		return
	var supply_used := 0
	for sup in race_state["supplies"]:
		if float(sup["cooldown"]) > 0.0:
			continue
		var m := _acquire_fx(_supply_pool, supply_used, _supply_mesh, _supply_mat)
		m.position = Vector3(float(sup["x"]), 0.55, float(sup["z"]))
		m.rotation.y = float(sup["yaw"]) + float(race_state["elapsed"]) * 1.4
		supply_used += 1
	_hide_unused_fx(_supply_pool, supply_used)

	var pulse_used := 0
	var snare_used := 0
	for w in race_state["weapons"]:
		if str(w["kind"]) == "pulse":
			var m := _acquire_fx(_pulse_pool, pulse_used, _pulse_mesh, _pulse_mat)
			m.position = Vector3(float(w["x"]), 0.65, float(w["z"]))
			pulse_used += 1
		else:
			var m := _acquire_fx(_snare_pool, snare_used, _snare_mesh, _snare_mat)
			m.position = Vector3(float(w["x"]), 0.2, float(w["z"]))
			snare_used += 1
	_hide_unused_fx(_pulse_pool, pulse_used)
	_hide_unused_fx(_snare_pool, snare_used)

	var hit_used := 0
	for h in race_state["hits"]:
		var m := _acquire_fx(_hit_pool, hit_used, _pulse_mesh, _hit_mat)
		var s := 1.0 + float(h["age"]) * 5.0
		m.scale = Vector3(s, s, s)
		m.position = Vector3(float(h["x"]), 0.8, float(h["z"]))
		hit_used += 1
	_hide_unused_fx(_hit_pool, hit_used)

func _process(delta: float) -> void:
	if race_screen != "racing" or race_mod == null or race_state.is_empty():
		_update_race_camera(false)
		return
	if race_countdown > 0.0:
		var prev_c := ceili(race_countdown)
		race_countdown = maxf(0.0, race_countdown - delta)
		if race_countdown == 0.0 or ceili(race_countdown) != prev_c:
			if race_countdown == 0.0:
				queued_pulse = false
				queued_snare = false
				_play_sfx("go")
			_rebuild_ui()
		_update_race_camera(true)
		return

	var step_dt := 1.0 / 60.0
	race_accum = minf(race_accum + delta, 0.1)
	var player: Dictionary = race_state["drivers"][0]
	var prev_pulses := int(player["pulses"])
	var prev_snares := int(player["snares"])
	var prev_shield := int(player["shield"])

	var gas := 1.0 if (Input.is_action_pressed("move_up") or Input.is_joy_button_pressed(0, JOY_BUTTON_A) or Input.get_joy_axis(0, JOY_AXIS_TRIGGER_RIGHT) > 0.2) else 0.0
	var brake := 1.0 if (Input.is_action_pressed("move_down") or Input.get_joy_axis(0, JOY_AXIS_TRIGGER_LEFT) > 0.2) else 0.0
	var throttle := gas - brake
	var steer := Input.get_axis("move_left", "move_right")
	var drift := Input.is_key_pressed(KEY_SPACE) or Input.is_joy_button_pressed(0, JOY_BUTTON_B) or Input.is_joy_button_pressed(0, JOY_BUTTON_LEFT_SHOULDER)
	var pulse_held := Input.is_key_pressed(KEY_J) or Input.is_joy_button_pressed(0, JOY_BUTTON_RIGHT_SHOULDER) or Input.is_joy_button_pressed(0, JOY_BUTTON_X)
	var snare_held := Input.is_key_pressed(KEY_K) or Input.is_joy_button_pressed(0, JOY_BUTTON_Y)

	while race_accum >= step_dt:
		race_accum -= step_dt
		var control := {
			"throttle": throttle,
			"steer": steer,
			"drift": drift,
			"pulse": queued_pulse or pulse_held,
			"snare": queued_snare or snare_held
		}
		queued_pulse = false
		queued_snare = false
		race_mod.stepRace(race_state, control, step_dt)

	if int(player["pulses"]) < prev_pulses:
		_play_sfx("pulse")
	if int(player["snares"]) < prev_snares:
		_play_sfx("snare")
	if int(player["shield"]) < prev_shield:
		_play_sfx("hit")

	var ts_drivers: Array = race_state["drivers"]
	for i in range(mini(car_nodes.size(), ts_drivers.size())):
		var d: Dictionary = ts_drivers[i]
		var car: Node3D = car_nodes[i]
		if car:
			car.position = Vector3(float(d["x"]), 0.0, float(d["z"]))
			car.rotation.y = float(d["yaw"])
			var speed := Vector2(float(d["vx"]), float(d["vz"])).length()
			var target_roll := -float(d["steer"]) * minf(0.19, speed * 0.011)
			car.rotation.z = lerpf(car.rotation.z, target_roll, clampf(delta * 10.0, 0.0, 1.0))

	_sync_race_fx()

	if player["finish"] != null:
		var place := _driver_place(0)
		var ts_circuit: Dictionary = race_state["circuit"]
		var qual := place <= int(ts_circuit["qualify"])
		var payout := int(prog_mod.recordResult(championship, ts_circuit, place, float(player["finish"]))) if prog_mod else 0
		if prog_mod:
			prog_mod.saveChampionship(runtime.storage, championship)
		race_result = { "place": place, "seconds": float(player["finish"]), "qualified": qual, "payout": payout }
		if qual:
			_play_sfx("podium")
		race_screen = "results"

	_update_race_camera(true)
	_rebuild_ui()

func _update_race_camera(follow: bool) -> void:
	if camera == null or race_state.is_empty():
		return
	if follow:
		var p: Dictionary = race_state["drivers"][0]
		var target := Vector3(float(p["x"]), 0.0, float(p["z"]))
		runtime.set_camera({ "projection": "orthographic", "size": 38.0, "position": target + Vector3(58.0, 58.0, 58.0), "target": target })
	else:
		runtime.set_camera({ "projection": "orthographic", "size": 64.0, "position": Vector3(68.0, 68.0, 68.0), "target": Vector3.ZERO })

func _fmt_time(sec: float) -> String:
	var cs := int(floor(sec * 100.0))
	var rem := str(cs % 6000).pad_zeros(4)
	return "%d:%s.%s" % [int(floor(float(cs) / 6000.0)), rem.substr(0, 2), rem.substr(2, 2)]

func _rebuild_ui() -> void:
	if ui == null or circuits.is_empty():
		return
	var vp := get_viewport().get_visible_rect().size
	var w := vp.x
	var h := vp.y
	var items: Array = []
	var sound_on := not runtime.is_muted()
	var c: Dictionary = circuits[circuit_index]

	if race_screen == "racing" and not race_state.is_empty():
		var p: Dictionary = race_state["drivers"][0]
		var pos := "%d / %d" % [_driver_place(0), (race_state["drivers"] as Array).size()]
		var lap_txt := "LAP %d / %d" % [mini(int(c["laps"]), int(p["lap"]) + 1), int(c["laps"])]
		var kmh := "%d" % roundi(Vector2(float(p["vx"]), float(p["vz"])).length() * 3.6)
		var surf := "REBOOTING" if float(p["disabled"]) > 0.0 else ("OFF TRACK" if bool(p["offroad"]) else ("DRIFTING" if bool(p["drift"]) else "ON TRACK"))
		var time_txt := _fmt_time(float(race_state["elapsed"]))
		var ui_key := "r|%d|%d|%d|%s|%s|%s|%s|%s|%d|%d|%d|%d" % [int(w), int(h), ceili(race_countdown), pos, lap_txt, kmh, surf, time_txt, int(p["shield"]), int(p["maxShield"]), int(p["pulses"]), int(p["snares"])]
		if ui_key == _last_ui_key:
			return
		_last_ui_key = ui_key
		items.append({ "type": "panel", "rect": Rect2(18, 18, 210, 90) })
		items.append({ "type": "text", "rect": Rect2(30, 26, 90, 16), "text": "POSITION", "size": 11, "color": Color("#f3bd88") })
		items.append({ "type": "text", "rect": Rect2(118, 26, 98, 16), "text": lap_txt, "size": 11, "align": "right", "color": Color("#f3bd88") })
		items.append({ "type": "text", "rect": Rect2(30, 44, 100, 32), "text": pos, "size": 26 })
		items.append({ "type": "text", "rect": Rect2(118, 52, 98, 20), "text": time_txt, "size": 13, "align": "right" })
		items.append({ "type": "text", "rect": Rect2(30, 82, 186, 18), "text": str(c["name"]).to_upper(), "size": 11, "color": Color("#f3bd88") })

		items.append({ "type": "panel", "rect": Rect2(18, h - 126, 210, 108) })
		items.append({ "type": "text", "rect": Rect2(30, h - 118, 110, 34), "text": kmh, "size": 30 })
		items.append({ "type": "text", "rect": Rect2(138, h - 106, 78, 18), "text": "KM/H", "size": 12, "align": "right", "color": Color("#f3bd88") })
		items.append({ "type": "text", "rect": Rect2(30, h - 78, 186, 16), "text": surf, "size": 11, "color": Color("#ff957c") if bool(p["offroad"]) else Color("#f3bd88") })
		items.append({ "type": "text", "rect": Rect2(30, h - 60, 186, 16), "text": "SHIELD %d / %d" % [int(p["shield"]), int(p["maxShield"])], "size": 11, "color": Color("#f3bd88") })
		items.append({ "type": "bar", "rect": Rect2(30, h - 42, 186, 5), "ratio": float(p["shield"]) / maxf(1.0, float(p["maxShield"])) })
		items.append({ "type": "text", "rect": Rect2(30, h - 32, 186, 16), "text": "PULSE %d  ·  SNARE %d" % [int(p["pulses"]), int(p["snares"])], "size": 11 })

		items.append({ "type": "button", "id": "race-recover", "rect": Rect2(w - 190, 18, 86, 38), "label": "Recover" })
		items.append({ "type": "button", "id": "race-pause", "rect": Rect2(w - 96, 18, 78, 38), "label": "Pause" })
		if race_countdown > 0.0:
			items.append({ "type": "panel", "rect": Rect2(w * 0.5 - 42, h * 0.28 - 32, 84, 64) })
			items.append({ "type": "text", "rect": Rect2(w * 0.5 - 42, h * 0.28 - 32, 84, 64), "text": str(ceili(race_countdown)), "size": 42, "align": "center" })
	else:
		_last_ui_key = ""
		items.append({ "type": "scrim", "rect": Rect2(0, 0, w, h), "fill": Color("#140f1296") if race_screen == "home" else Color("#120e0ec2") })
		var card_w := minf(w - 40.0, 480.0 if race_screen == "events" else 410.0)
		var card_h := 390.0 if race_screen == "events" else 318.0
		var cx := 48.0 if race_screen == "home" else (w - card_w) * 0.5
		var cy := (h - card_h) * 0.5
		items.append({ "type": "panel", "rect": Rect2(cx, cy, card_w, card_h) })
		var title := "SIGNAL DRIFT" if race_screen == "home" else ("EVENTS" if race_screen == "events" else ("RACE PAUSED" if race_screen == "paused" else "RACE COMPLETE"))
		var kicker := "CHAMPIONSHIP" if race_screen == "home" else str(c["name"]).to_upper()
		items.append({ "type": "text", "rect": Rect2(cx + 24, cy + 20, card_w - 48, 18), "text": kicker, "size": 12, "color": Color("#f8aa4e") })
		items.append({ "type": "text", "rect": Rect2(cx + 24, cy + 44, card_w - 48, 40), "text": title, "size": 32 })
		var y := cy + 96.0
		if race_screen == "events":
			for idx in range(circuits.size()):
				var ev: Dictionary = circuits[idx]
				items.append({ "type": "button", "id": "event-%d" % idx, "rect": Rect2(cx + 24, y, card_w - 48, 50), "label": str(ev["name"]), "subtitle": "%d laps · Top %d · %s" % [int(ev["laps"]), int(ev["qualify"]), str(ev["description"])], "primary": idx == circuit_index })
				y += 58.0
			items.append({ "type": "button", "id": "race-home", "rect": Rect2(cx + 24, y + 6, card_w - 48, 40), "label": "Back" })
		else:
			var desc := "%s · %d laps" % [str(c["name"]), int(c["laps"])]
			if race_screen == "results" and not race_result.is_empty():
				desc = "Finished #%d · %s" % [int(race_result["place"]), _fmt_time(float(race_result["seconds"]))]
			items.append({ "type": "text", "rect": Rect2(cx + 24, y, card_w - 48, 22), "text": desc, "size": 14, "color": Color("#d8beaa") })
			y += 36.0
			items.append({ "type": "button", "id": "race-start", "rect": Rect2(cx + 24, y, card_w - 48, 44), "label": ("Race " + str(c["name"])) if race_screen == "home" else ("Resume race" if race_screen == "paused" else "Race again"), "primary": true })
			y += 52.0
			var half := (card_w - 56.0) * 0.5
			if race_screen == "home":
				items.append({ "type": "button", "id": "race-events", "rect": Rect2(cx + 24, y, half, 40), "label": "Events" })
				items.append({ "type": "toggle", "id": "sound", "rect": Rect2(cx + 32 + half, y, half, 40), "label": "Sound", "checked": sound_on })
				y += 48.0
				items.append({ "type": "button", "id": "quit", "rect": Rect2(cx + 24, y, card_w - 48, 38), "label": "Quit" })
			elif race_screen == "paused":
				items.append({ "type": "button", "id": "race-restart", "rect": Rect2(cx + 24, y, half, 40), "label": "Restart" })
				items.append({ "type": "button", "id": "race-home", "rect": Rect2(cx + 32 + half, y, half, 40), "label": "Main menu" })
			else:
				items.append({ "type": "button", "id": "race-next", "rect": Rect2(cx + 24, y, half, 40), "label": "Next circuit" })
				items.append({ "type": "button", "id": "race-home", "rect": Rect2(cx + 32 + half, y, half, 40), "label": "Main menu" })
			items.append({ "type": "text", "rect": Rect2(cx + 24, cy + card_h - 30, card_w - 48, 18), "text": "WASD/Arrows Drive · Space Drift · J Pulse · K Snare · R Recover", "size": 11, "color": Color("#d8beaa"), "align": "center" })

	ui.set_items(items)
