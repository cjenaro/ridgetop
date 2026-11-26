extends Node3D

# Generic Ridgetop -> Godot 4 Runtime Bridge.
# Mirrors Ridgetop's core browser abstractions in native Godot 4:
#   - Low-Poly Renderer Bridge: Camera3D, DirectionalLight3D, WorldEnvironment (sky/ambient/distance fog),
#     up to 4 dynamic OmniLight3D point lights, and instanced MultiMeshInstance3D / pooled MeshInstance3D
#     batches supporting opaque, alpha, and additive blend modes.
#   - Rig & Animation Bridge: Hierarchical Node3D joint trees matching framework/animation.ts (createRig + JointPose).
#   - Particle Bridge: Pooled 3D velocity & parabolic-arc emitter matching createParticles().
#   - Soundscape & Audio Bridge: Multi-bus AudioServer mixer (Master, Music, SFX, Ambience) with WAV SFX
#     playback and ambient bed volume/filter control.
#   - Generic Asset, Compiled Module, and Persistent Save Storage helpers.

class GodotStorage extends RefCounted:
	var path: String = "user://ridgetop_save.json"
	var data: Dictionary = {}

	func _init(save_path: String = "user://ridgetop_save.json") -> void:
		path = save_path
		if FileAccess.file_exists(path):
			var raw := FileAccess.get_file_as_string(path)
			var parsed = JSON.parse_string(raw)
			if typeof(parsed) == TYPE_DICTIONARY:
				data = parsed

	func getItem(key: String) -> Variant:
		return data[key] if data.has(key) else null

	func setItem(key: String, value: String) -> void:
		data[key] = value
		_persist()

	func removeItem(key: String) -> void:
		data.erase(key)
		_persist()

	func clear() -> void:
		data.clear()
		_persist()

	func _persist() -> void:
		var f := FileAccess.open(path, FileAccess.WRITE)
		if f:
			f.store_string(JSON.stringify(data))


class InstancedBatch extends RefCounted:
	var node: MultiMeshInstance3D
	var multimesh: MultiMesh
	var material: StandardMaterial3D
	var blend_mode: String = "opaque"
	var unlit: bool = false
	var count: int = 0
	var capacity: int = 0
	var _transforms: Array[Transform3D] = []
	var _colors: Array[Color] = []

	func _init(mesh_res: Mesh, mat: StandardMaterial3D, blend: String, is_unlit: bool, initial_cap: int, parent_node: Node) -> void:
		blend_mode = blend
		unlit = is_unlit
		material = mat
		capacity = maxi(4, initial_cap)
		multimesh = MultiMesh.new()
		multimesh.transform_format = MultiMesh.TRANSFORM_3D
		multimesh.use_colors = true
		multimesh.mesh = mesh_res
		multimesh.instance_count = capacity
		multimesh.visible_instance_count = 0
		node = MultiMeshInstance3D.new()
		node.multimesh = multimesh
		node.material_override = material
		if parent_node:
			parent_node.add_child(node)

	func clear() -> void:
		count = 0
		_transforms.clear()
		_colors.clear()
		if multimesh:
			multimesh.visible_instance_count = 0

	func _ensure_capacity(needed: int) -> void:
		if needed <= capacity:
			return
		var next_cap := maxi(capacity * 2, needed)
		capacity = next_cap
		multimesh.instance_count = capacity
		for i in range(count):
			multimesh.set_instance_transform(i, _transforms[i])
			multimesh.set_instance_color(i, _colors[i])

	func add(pos: Vector3, scl: Vector3 = Vector3.ONE, rot: Variant = 0.0, col: Color = Color.WHITE, _unlit_override: float = 0.0) -> void:
		_ensure_capacity(count + 1)
		var q := _coerce_quat(rot)
		var safe_scl := Vector3(maxf(0.0001, scl.x), maxf(0.0001, scl.y), maxf(0.0001, scl.z))
		var xf := Transform3D(Basis(q).scaled_local(safe_scl), pos)
		_transforms.append(xf)
		_colors.append(col)
		multimesh.set_instance_transform(count, xf)
		multimesh.set_instance_color(count, col)
		count += 1
		multimesh.visible_instance_count = count

	func flush() -> void:
		if multimesh:
			multimesh.visible_instance_count = count

	func get_count() -> int:
		return count

	func get_blend_mode() -> String:
		return blend_mode

	func dispose() -> void:
		clear()
		if node and is_instance_valid(node):
			node.queue_free()
		node = null

	static func _coerce_quat(rot: Variant) -> Quaternion:
		if rot is Quaternion:
			return rot as Quaternion
		if rot is float or rot is int:
			return Quaternion(Vector3.UP, float(rot))
		if rot is Vector3:
			var v := rot as Vector3
			return _euler_to_quat(v.x, v.y, v.z)
		if rot is Array:
			var a := rot as Array
			if a.size() >= 4:
				return Quaternion(float(a[0]), float(a[1]), float(a[2]), float(a[3])).normalized()
			if a.size() >= 3:
				return _euler_to_quat(float(a[0]), float(a[1]), float(a[2]))
		return Quaternion.IDENTITY

	static func _euler_to_quat(pitch: float, yaw: float, roll: float) -> Quaternion:
		var sx := sin(pitch * 0.5)
		var cx := cos(pitch * 0.5)
		var sy := sin(yaw * 0.5)
		var cy := cos(yaw * 0.5)
		var sz := sin(roll * 0.5)
		var cz := cos(roll * 0.5)
		return Quaternion(
			cy * sx * cz + sy * cx * sz,
			sy * cx * cz - cy * sx * sz,
			cy * cx * sz - sy * sx * cz,
			cy * cx * cz + sy * sx * sz
		)


class MeshInstancePool extends RefCounted:
	var mesh: Mesh
	var base_material: StandardMaterial3D
	var blend_mode: String = "opaque"
	var unlit: float = 0.0
	var parent_node: Node
	var pool: Array[MeshInstance3D] = []
	var cursor: int = 0

	func _init(mesh_res: Mesh, mat: StandardMaterial3D, blend: String, unlit_val: float, parent: Node) -> void:
		mesh = mesh_res
		base_material = mat
		blend_mode = blend
		unlit = unlit_val
		parent_node = parent

	func begin_frame() -> void:
		cursor = 0

	func acquire(pos: Vector3 = Vector3.ZERO, scl: Vector3 = Vector3.ONE, rot: Variant = 0.0, col: Variant = null) -> MeshInstance3D:
		while pool.size() <= cursor:
			var mi := MeshInstance3D.new()
			mi.mesh = mesh
			mi.material_override = base_material.duplicate() as StandardMaterial3D
			if parent_node:
				parent_node.add_child(mi)
			pool.append(mi)
		var node: MeshInstance3D = pool[cursor]
		cursor += 1
		node.visible = true
		node.position = pos
		node.scale = Vector3(maxf(0.0001, scl.x), maxf(0.0001, scl.y), maxf(0.0001, scl.z))
		node.quaternion = InstancedBatch._coerce_quat(rot)
		if col is Color:
			var mat := node.material_override as StandardMaterial3D
			if mat:
				var c := col as Color
				mat.albedo_color = c
				if unlit > 0.02 and mat.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED:
					mat.emission_enabled = true
					mat.emission = Color(c.r, c.g, c.b, 1.0)
					mat.emission_energy_multiplier = unlit
		return node

	func end_frame() -> void:
		for i in range(cursor, pool.size()):
			if is_instance_valid(pool[i]):
				pool[i].visible = false

	func get_active_count() -> int:
		return cursor

	func get_pool_size() -> int:
		return pool.size()

	func dispose() -> void:
		for mi in pool:
			if is_instance_valid(mi):
				mi.queue_free()
		pool.clear()
		cursor = 0


class RigInstance extends RefCounted:
	var root: Node3D
	var joints: Dictionary = {}
	var pivots: Dictionary = {}
	var parent_ids: Dictionary = {}
	var order: Array[String] = []
	var world_transforms: Dictionary = {}

	func _init(parent_node: Node) -> void:
		root = Node3D.new()
		root.name = "RigRoot"
		if parent_node:
			parent_node.add_child(root)

	func get_joint(joint_id: String) -> Node3D:
		if joints.has(joint_id):
			return joints[joint_id] as Node3D
		return null

	func get_joint_world_position(joint_id: String) -> Vector3:
		if world_transforms.has(joint_id):
			var xf: Dictionary = world_transforms[joint_id]
			return xf.get("position", Vector3.ZERO) as Vector3
		return Vector3.ZERO

	func apply_poses(poses: Dictionary, root_pose: Dictionary = {}) -> Dictionary:
		var root_pos := root.position
		if root_pose.has("position"):
			root_pos = _vec3_from(root_pose["position"], root_pos)
		var root_rot := root.quaternion
		if root_pose.has("rotation"):
			root_rot = InstancedBatch._coerce_quat(root_pose["rotation"])
		elif root_pose.has("yaw"):
			root_rot = Quaternion(Vector3.UP, float(root_pose["yaw"]))
		var root_scl := root.scale
		if root_pose.has("scale"):
			var sv = root_pose["scale"]
			if sv is float or sv is int:
				var sf := maxf(0.0001, float(sv))
				root_scl = Vector3(sf, sf, sf)
			else:
				root_scl = _vec3_from(sv, Vector3.ONE)
				root_scl = Vector3(maxf(0.0001, root_scl.x), maxf(0.0001, root_scl.y), maxf(0.0001, root_scl.z))
		root.position = root_pos
		root.quaternion = root_rot
		root.scale = root_scl

		for jid in order:
			var pose: Dictionary = {}
			if poses.has(jid) and poses[jid] is Dictionary:
				pose = poses[jid] as Dictionary
			var pid := str(parent_ids.get(jid, ""))
			var p_pos := root_pos
			var p_rot := root_rot
			var p_scl := root_scl
			if pid != "" and world_transforms.has(pid):
				var pxf: Dictionary = world_transforms[pid]
				p_pos = pxf["position"] as Vector3
				p_rot = pxf["quaternion"] as Quaternion
				p_scl = pxf["scale"] as Vector3

			var piv: Vector3 = pivots.get(jid, Vector3.ZERO) as Vector3
			var off := _vec3_from(pose.get("position", Vector3.ZERO), Vector3.ZERO) if pose.has("position") else Vector3.ZERO
			var local_pos := piv + off
			var local_rot := InstancedBatch._coerce_quat(pose["rotation"]) if pose.has("rotation") else Quaternion.IDENTITY
			var raw_scl := Vector3.ONE
			if pose.has("scale"):
				var jsv = pose["scale"]
				if jsv is float or jsv is int:
					var jsf := float(jsv)
					raw_scl = Vector3(jsf, jsf, jsf)
				else:
					raw_scl = _vec3_from(jsv, Vector3.ONE)
			var local_scl := Vector3(maxf(0.0001, raw_scl.x), maxf(0.0001, raw_scl.y), maxf(0.0001, raw_scl.z))

			var jnode: Node3D = joints[jid] as Node3D
			if jnode and is_instance_valid(jnode):
				jnode.position = local_pos
				jnode.quaternion = local_rot
				jnode.scale = local_scl

			var scaled_local := Vector3(local_pos.x * p_scl.x, local_pos.y * p_scl.y, local_pos.z * p_scl.z)
			var w_pos := p_pos + (p_rot * scaled_local)
			var w_rot := (p_rot * local_rot).normalized()
			var w_scl := Vector3(p_scl.x * local_scl.x, p_scl.y * local_scl.y, p_scl.z * local_scl.z)
			world_transforms[jid] = {
				"position": w_pos,
				"quaternion": w_rot,
				"scale": w_scl,
				"node": jnode
			}
		return world_transforms

	func dispose() -> void:
		if root and is_instance_valid(root):
			root.queue_free()
		root = null
		joints.clear()
		pivots.clear()
		parent_ids.clear()
		order.clear()
		world_transforms.clear()

	static func _vec3_from(v: Variant, fallback: Vector3) -> Vector3:
		if v is Vector3:
			return v as Vector3
		if v is Array and (v as Array).size() >= 3:
			var a := v as Array
			return Vector3(float(a[0]), float(a[1]), float(a[2]))
		if v is Dictionary:
			var d := v as Dictionary
			return Vector3(float(d.get("x", fallback.x)), float(d.get("y", fallback.y)), float(d.get("z", fallback.z)))
		return fallback


class ParticleSystem extends RefCounted:
	var max_particles: int = 240
	var particles: Array[Dictionary] = []
	var batches: Dictionary = {}
	var root: Node3D
	var _runtime: Node

	func _init(rt: Node, limit: int, parent_node: Node) -> void:
		_runtime = rt
		max_particles = maxi(1, limit)
		root = Node3D.new()
		root.name = "ParticlesRoot"
		if parent_node:
			parent_node.add_child(root)

	func get_count() -> int:
		return particles.size()

	func clear() -> void:
		particles.clear()
		for b in batches.values():
			(b as InstancedBatch).clear()

	func _push(p: Dictionary) -> void:
		if particles.size() >= max_particles:
			particles.pop_front()
		particles.append(p)

	func spawn(opts: Dictionary) -> void:
		var pos: Vector3 = _runtime._to_vec3(opts.get("position", Vector3.ZERO), Vector3.ZERO)
		var vel: Vector3 = _runtime._to_vec3(opts.get("velocity", Vector3.ZERO), Vector3.ZERO)
		var scl: Vector3 = _runtime._to_scale_vec3(opts.get("scale", Vector3.ONE), Vector3.ONE)
		var col: Color = _runtime._to_color(opts.get("color", Color.WHITE), Color.WHITE)
		var end_scale := float(opts.get("endScale", opts.get("end_scale", 0.05)))
		var alpha_fade := bool(opts.get("alphaFade", opts.get("alpha_fade", false)))
		var blend := str(opts.get("blend", "opaque"))
		if alpha_fade and blend == "opaque":
			blend = "alpha"
		_push({
			"mode": "vel",
			"mesh": opts.get("mesh", "box"),
			"blend": blend,
			"alpha_fade": alpha_fade,
			"pos": pos,
			"vel": vel,
			"from": pos,
			"to": pos,
			"peak": 0.0,
			"gravity": float(opts.get("gravity", 0.0)),
			"drag": float(opts.get("drag", 0.0)),
			"scale": scl,
			"end_scale": end_scale,
			"yaw": float(opts.get("yaw", 0.0)),
			"spin": float(opts.get("spin", 0.0)),
			"color": col,
			"unlit": float(opts.get("unlit", 0.0)),
			"age": 0.0,
			"life": maxf(0.05, float(opts.get("life", 0.5)))
		})

	func arc(opts: Dictionary) -> void:
		var from_pos: Vector3 = _runtime._to_vec3(opts.get("from", Vector3.ZERO), Vector3.ZERO)
		var to_pos: Vector3 = _runtime._to_vec3(opts.get("to", Vector3.ZERO), Vector3.ZERO)
		var scl: Vector3 = _runtime._to_scale_vec3(opts.get("scale", Vector3.ONE), Vector3.ONE)
		var col: Color = _runtime._to_color(opts.get("color", Color.WHITE), Color.WHITE)
		var end_scale := float(opts.get("endScale", opts.get("end_scale", 0.65)))
		_push({
			"mode": "arc",
			"mesh": opts.get("mesh", "box"),
			"blend": str(opts.get("blend", "opaque")),
			"alpha_fade": false,
			"pos": from_pos,
			"vel": Vector3.ZERO,
			"from": from_pos,
			"to": to_pos,
			"peak": float(opts.get("peak", 1.6)),
			"gravity": 0.0,
			"drag": 0.0,
			"scale": scl,
			"end_scale": end_scale,
			"yaw": 0.0,
			"spin": float(opts.get("spin", 6.0)),
			"color": col,
			"unlit": float(opts.get("unlit", 0.25)),
			"age": 0.0,
			"life": maxf(0.08, float(opts.get("duration", 0.4)))
		})

	func step(dt: float) -> void:
		var i := particles.size() - 1
		while i >= 0:
			var p: Dictionary = particles[i]
			var age := float(p["age"]) + dt
			var life := float(p["life"])
			if age >= life:
				particles.remove_at(i)
				i -= 1
				continue
			p["age"] = age
			p["yaw"] = float(p["yaw"]) + float(p["spin"]) * dt
			if str(p["mode"]) == "vel":
				var v: Vector3 = p["vel"] as Vector3
				v.y -= float(p["gravity"]) * dt
				var drag := float(p["drag"])
				if drag > 0.0:
					var damp := maxf(0.0, 1.0 - drag * dt)
					v *= damp
				p["vel"] = v
				p["pos"] = (p["pos"] as Vector3) + v * dt
			else:
				var u := age / life
				var fpos: Vector3 = p["from"] as Vector3
				var tpos: Vector3 = p["to"] as Vector3
				var interp := fpos.lerp(tpos, u)
				interp.y += sin(u * PI) * float(p["peak"])
				p["pos"] = interp
			i -= 1
		emit_batches()

	func emit_batches() -> void:
		for b in batches.values():
			(b as InstancedBatch).clear()
		for p in particles:
			var u := clampf(float(p["age"]) / maxf(0.0001, float(p["life"])), 0.0, 1.0)
			var end_s := float(p["end_scale"])
			var factor := (1.0 + sin(u * PI) * 0.22 - (1.0 - end_s) * u * 0.5) if str(p["mode"]) == "arc" else maxf(0.02, 1.0 + (end_s - 1.0) * u)
			var base_scl: Vector3 = p["scale"] as Vector3
			var scl := Vector3(maxf(0.01, base_scl.x * factor), maxf(0.01, base_scl.y * factor), maxf(0.01, base_scl.z * factor))
			var col: Color = p["color"] as Color
			if bool(p["alpha_fade"]):
				col = Color(col.r, col.g, col.b, col.a * (1.0 - u))
			var blend := str(p["blend"])
			var is_unlit := float(p["unlit"]) > 0.35 or blend == "additive"
			var mesh_spec = p["mesh"]
			var mesh_key := str(mesh_spec) if mesh_spec is String else str(mesh_spec.get_instance_id())
			var batch_key := "%s|%s|%d" % [mesh_key, blend, 1 if is_unlit else 0]
			var batch: InstancedBatch
			if batches.has(batch_key):
				batch = batches[batch_key] as InstancedBatch
			else:
				batch = _runtime.create_batch(mesh_spec, blend, 32, is_unlit, root)
				batches[batch_key] = batch
			batch.add(p["pos"] as Vector3, scl, float(p["yaw"]), col, float(p["unlit"]))

	func dispose() -> void:
		particles.clear()
		for b in batches.values():
			(b as InstancedBatch).dispose()
		batches.clear()
		if root and is_instance_valid(root):
			root.queue_free()
		root = null
		_runtime = null


const MAX_POINT_LIGHTS: int = 4

var host_root: Node3D = null
var camera: Camera3D = null
var directional_light: DirectionalLight3D = null
var world_env: WorldEnvironment = null
var ui: Control = null
var point_lights: Array[OmniLight3D] = []
var lighting_state: Dictionary = {
	"direction": Vector3(-0.48, 0.8, 0.36).normalized(),
	"ambient": 0.52,
	"color": Color(1.0, 1.0, 1.0, 1.0),
	"fog_color": Color(0.129, 0.224, 0.243, 1.0),
	"fog_near": 0.0,
	"fog_far": 0.0,
	"fog_enabled": false,
	"active_points": 0
}

var sound_enabled: bool = true
var music_enabled: bool = true
var master_volume: float = 0.72
var music_volume: float = 0.16
var sfx_volume: float = 0.28
var ambience_volume: float = 1.0
var sfx_players: Array[AudioStreamPlayer] = []
var _sfx_cursor: int = 0
var ambient_beds: Dictionary = {}
var audio_cache: Dictionary = {}
var _pink_noise_stream: AudioStreamWAV = null
var _music_filter: AudioEffectLowPassFilter = null
var _ambience_filter: AudioEffectLowPassFilter = null

var models_cache: Dictionary = {}
var mesh_cache: Dictionary = {}
var rt_script: GDScript = null
var storage: GodotStorage = null
var _batches: Array = []
var _pools: Array = []
var _rigs: Array = []
var _particle_systems: Array = []
var _initialized: bool = false

func setup(root_node: Node3D, cam: Camera3D = null, dir_light: DirectionalLight3D = null, env: WorldEnvironment = null, ui_node: Control = null) -> void:
	if _initialized:
		return
	_initialized = true
	host_root = root_node if root_node != null else self
	camera = cam if cam != null else (host_root.get_node_or_null("Camera3D") as Camera3D)
	if camera == null:
		camera = Camera3D.new()
		camera.name = "Camera3D"
		camera.current = true
		host_root.add_child(camera)

	directional_light = dir_light if dir_light != null else (host_root.get_node_or_null("DirectionalLight3D") as DirectionalLight3D)
	if directional_light == null:
		directional_light = DirectionalLight3D.new()
		directional_light.name = "DirectionalLight3D"
		directional_light.light_energy = 1.15
		host_root.add_child(directional_light)

	world_env = env if env != null else (host_root.get_node_or_null("WorldEnvironment") as WorldEnvironment)
	if world_env == null:
		world_env = WorldEnvironment.new()
		world_env.name = "WorldEnvironment"
		host_root.add_child(world_env)
	if world_env.environment == null:
		var e := Environment.new()
		e.background_mode = Environment.BG_COLOR
		e.background_color = Color(0.129, 0.224, 0.243, 1.0)
		e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		e.ambient_light_color = Color(0.86, 0.93, 0.94, 1.0)
		e.ambient_light_energy = 0.62
		world_env.environment = e

	ui = ui_node if ui_node != null else (host_root.get_node_or_null("UI") as Control)

	point_lights.clear()
	for i in range(MAX_POINT_LIGHTS):
		var pl := OmniLight3D.new()
		pl.name = "PointLight%d" % i
		pl.visible = false
		pl.omni_attenuation = 1.5
		add_child(pl)
		point_lights.append(pl)

	ensure_audio_buses()
	sfx_players.clear()
	for _i in range(8):
		var p := AudioStreamPlayer.new()
		p.bus = "SFX"
		add_child(p)
		sfx_players.append(p)

	storage = GodotStorage.new()
	if ResourceLoader.exists("res://scripts/compiled/rt.gd"):
		rt_script = load("res://scripts/compiled/rt.gd")

func _exit_tree() -> void:
	cleanup()

func cleanup() -> void:
	for p in sfx_players:
		if is_instance_valid(p):
			p.stop()
			p.stream = null
	for bed_val in ambient_beds.values():
		var bed: Dictionary = bed_val as Dictionary
		var bp = bed.get("player", null)
		if bp is AudioStreamPlayer and is_instance_valid(bp):
			(bp as AudioStreamPlayer).stop()
			(bp as AudioStreamPlayer).stream = null
			(bp as AudioStreamPlayer).queue_free()
	ambient_beds.clear()
	for b in _batches:
		if b != null:
			(b as InstancedBatch).dispose()
	_batches.clear()
	for pool in _pools:
		if pool != null:
			(pool as MeshInstancePool).dispose()
	_pools.clear()
	for rig in _rigs:
		if rig != null:
			(rig as RigInstance).dispose()
	_rigs.clear()
	for ps in _particle_systems:
		if ps != null:
			(ps as ParticleSystem).dispose()
	_particle_systems.clear()
	for val in models_cache.values():
		if val is Node and is_instance_valid(val):
			(val as Node).free()
	models_cache.clear()
	mesh_cache.clear()
	audio_cache.clear()
	_pink_noise_stream = null
	if rt_script:
		rt_script.clear_modules()

# ==============================================================================
# CONVERSION & MATH HELPERS
# ==============================================================================

static func quat_from_euler(pitch: float = 0.0, yaw: float = 0.0, roll: float = 0.0) -> Quaternion:
	return InstancedBatch._euler_to_quat(pitch, yaw, roll)

func _to_vec3(v: Variant, fallback: Vector3 = Vector3.ZERO) -> Vector3:
	if v is Vector3:
		return v as Vector3
	if v is Array and (v as Array).size() >= 3:
		var a := v as Array
		return Vector3(float(a[0]), float(a[1]), float(a[2]))
	if v is Dictionary:
		var d := v as Dictionary
		return Vector3(float(d.get("x", fallback.x)), float(d.get("y", fallback.y)), float(d.get("z", fallback.z)))
	return fallback

func _to_scale_vec3(v: Variant, fallback: Vector3 = Vector3.ONE) -> Vector3:
	if v is float or v is int:
		var s := maxf(0.0001, float(v))
		return Vector3(s, s, s)
	var vec := _to_vec3(v, fallback)
	return Vector3(maxf(0.0001, vec.x), maxf(0.0001, vec.y), maxf(0.0001, vec.z))

func _to_color(v: Variant, fallback: Color = Color.WHITE) -> Color:
	if v is Color:
		return v as Color
	if v is String:
		var s := (v as String).strip_edges()
		if s != "":
			return Color(s)
		return fallback
	if v is Array:
		var a := v as Array
		if a.size() >= 4:
			return Color(float(a[0]), float(a[1]), float(a[2]), float(a[3]))
		if a.size() >= 3:
			return Color(float(a[0]), float(a[1]), float(a[2]), 1.0)
	if v is Dictionary:
		var d := v as Dictionary
		return Color(float(d.get("r", fallback.r)), float(d.get("g", fallback.g)), float(d.get("b", fallback.b)), float(d.get("a", fallback.a)))
	return fallback

static func _safe_looking_at(forward: Vector3, up_hint: Vector3 = Vector3.UP) -> Basis:
	var f := forward
	if f.length_squared() < 1e-8:
		f = Vector3.FORWARD
	else:
		f = f.normalized()
	var up := up_hint.normalized() if up_hint.length_squared() > 1e-8 else Vector3.UP
	if absf(f.dot(up)) > 0.995:
		up = Vector3.BACK if absf(f.y) > 0.5 else Vector3.UP
	return Basis.looking_at(f, up)

# ==============================================================================
# SCENE, CAMERA & LOW-POLY LIGHTING BRIDGE (matches renderer.setLighting)
# ==============================================================================

func set_clear_color(col_val: Variant) -> void:
	if world_env and world_env.environment:
		var c := _to_color(col_val, Color(0.129, 0.224, 0.243, 1.0))
		world_env.environment.background_mode = Environment.BG_COLOR
		world_env.environment.background_color = Color(c.r, c.g, c.b, 1.0)

func set_camera(opts: Dictionary) -> void:
	if camera == null:
		return
	var proj := str(opts.get("projection", "perspective")).to_lower()
	if proj == "orthographic" or proj == "ortho":
		camera.projection = Camera3D.PROJECTION_ORTHOGONAL
		if opts.has("size"):
			camera.size = maxf(0.1, float(opts["size"]))
	else:
		camera.projection = Camera3D.PROJECTION_PERSPECTIVE
		if opts.has("fov"):
			camera.fov = clampf(float(opts["fov"]), 5.0, 170.0)
		elif opts.has("fovRad"):
			camera.fov = clampf(rad_to_deg(float(opts["fovRad"])), 5.0, 170.0)
	if opts.has("near"):
		camera.near = maxf(0.01, float(opts["near"]))
	if opts.has("far"):
		camera.far = maxf(camera.near + 0.1, float(opts["far"]))
	var eye := _to_vec3(opts.get("position", opts.get("eye", camera.position)), camera.position)
	if opts.has("target"):
		var tgt := _to_vec3(opts["target"], Vector3.ZERO)
		var up := _to_vec3(opts.get("up", Vector3.UP), Vector3.UP)
		camera.transform = Transform3D(_safe_looking_at(tgt - eye, up), eye)
	else:
		camera.position = eye

func set_lighting(opts: Dictionary) -> void:
	if opts.has("clear") or opts.has("clearColor") or opts.has("skyColor"):
		set_clear_color(opts.get("clear", opts.get("clearColor", opts.get("skyColor"))))

	if opts.has("direction"):
		var dir := _to_vec3(opts["direction"], Vector3(-0.48, 0.8, 0.36))
		if dir.length_squared() > 1e-8:
			var dir_n := dir.normalized()
			lighting_state["direction"] = dir_n
			if directional_light:
				directional_light.basis = _safe_looking_at(-dir_n, Vector3.UP)

	if opts.has("ambient"):
		var amb := clampf(float(opts["ambient"]), 0.0, 1.0)
		lighting_state["ambient"] = amb
		if world_env and world_env.environment:
			world_env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
			world_env.environment.ambient_light_energy = amb
		if directional_light and not opts.has("energy"):
			directional_light.light_energy = maxf(0.15, 1.25 - amb * 0.35)

	if opts.has("energy") and directional_light:
		directional_light.light_energy = maxf(0.0, float(opts["energy"]))

	if opts.has("color"):
		var lc := _to_color(opts["color"], Color.WHITE)
		lighting_state["color"] = lc
		if directional_light:
			directional_light.light_color = Color(lc.r, lc.g, lc.b, 1.0)
		if world_env and world_env.environment and not opts.has("ambientColor"):
			world_env.environment.ambient_light_color = Color(lc.r, lc.g, lc.b, 1.0)

	if opts.has("ambientColor") and world_env and world_env.environment:
		var ac := _to_color(opts["ambientColor"], Color.WHITE)
		world_env.environment.ambient_light_color = Color(ac.r, ac.g, ac.b, 1.0)

	if opts.has("fogColor") or opts.has("fog_color"):
		var fc := _to_color(opts.get("fogColor", opts.get("fog_color")), Color(0.5, 0.6, 0.7, 1.0))
		lighting_state["fog_color"] = fc
		if world_env and world_env.environment:
			world_env.environment.fog_light_color = Color(fc.r, fc.g, fc.b, 1.0)

	if opts.has("fogNear") or opts.has("fog_near") or opts.has("fogFar") or opts.has("fog_far"):
		var fnear := float(opts.get("fogNear", opts.get("fog_near", lighting_state.get("fog_near", 0.0))))
		var ffar := float(opts.get("fogFar", opts.get("fog_far", lighting_state.get("fog_far", 0.0))))
		var enabled := ffar > fnear and ffar > 0.0
		lighting_state["fog_near"] = fnear
		lighting_state["fog_far"] = ffar
		lighting_state["fog_enabled"] = enabled
		if world_env and world_env.environment:
			var env := world_env.environment
			env.fog_enabled = enabled
			if enabled:
				env.fog_mode = Environment.FOG_MODE_DEPTH
				env.fog_density = 1.0
				env.fog_depth_curve = 1.0
				env.fog_depth_begin = maxf(0.0, fnear)
				env.fog_depth_end = maxf(env.fog_depth_begin + 0.01, ffar)
				env.fog_light_color = lighting_state["fog_color"] as Color
				env.fog_light_energy = 1.0

	if opts.has("points") and opts["points"] is Array:
		var pts: Array = opts["points"] as Array
		var count := mini(MAX_POINT_LIGHTS, pts.size())
		lighting_state["active_points"] = count
		for i in range(point_lights.size()):
			var pl: OmniLight3D = point_lights[i]
			if i < count and pts[i] is Dictionary:
				var pt: Dictionary = pts[i] as Dictionary
				pl.visible = true
				pl.position = _to_vec3(pt.get("position", Vector3.ZERO), Vector3.ZERO)
				var pc := _to_color(pt.get("color", Color.WHITE), Color.WHITE)
				pl.light_color = Color(pc.r, pc.g, pc.b, 1.0)
				pl.omni_range = maxf(0.05, float(pt.get("radius", 4.0)))
				pl.light_energy = maxf(0.0, float(pt.get("intensity", 1.0)))
			else:
				pl.visible = false

# ==============================================================================
# PRIMITIVE MESHES, MATERIALS & INSTANCED / POOLED BATCHES
# ==============================================================================

func get_primitive_mesh(kind: String) -> Mesh:
	var key := kind.to_lower()
	if mesh_cache.has(key):
		return mesh_cache[key] as Mesh
	var m: Mesh
	if key == "sphere":
		var sm := SphereMesh.new()
		sm.radius = 0.5
		sm.height = 1.0
		sm.radial_segments = 12
		sm.rings = 6
		m = sm
	elif key == "cylinder" or key == "drum":
		var cm := CylinderMesh.new()
		cm.top_radius = 0.5
		cm.bottom_radius = 0.5
		cm.height = 1.0
		cm.radial_segments = 10
		m = cm
	elif key == "cone":
		var cone := CylinderMesh.new()
		cone.top_radius = 0.0
		cone.bottom_radius = 0.5
		cone.height = 1.0
		cone.radial_segments = 10
		m = cone
	elif key == "octahedron":
		m = _build_octahedron_mesh()
	elif key == "disc" or key == "shadow_disc":
		m = _build_disc_mesh(12)
	elif key == "prism":
		var pm := PrismMesh.new()
		pm.size = Vector3.ONE
		m = pm
	else:
		var bm := BoxMesh.new()
		bm.size = Vector3.ONE
		m = bm
	mesh_cache[key] = m
	return m

func _build_octahedron_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var verts := [
		Vector3(0.0, 1.0, 0.0), Vector3(1.0, 0.0, 0.0), Vector3(0.0, 0.0, 1.0),
		Vector3(-1.0, 0.0, 0.0), Vector3(0.0, 0.0, -1.0), Vector3(0.0, -1.0, 0.0)
	]
	var faces := [
		[0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 1],
		[5, 2, 1], [5, 3, 2], [5, 4, 3], [5, 1, 4]
	]
	for f in faces:
		var a: Vector3 = verts[int(f[0])]
		var b: Vector3 = verts[int(f[1])]
		var c: Vector3 = verts[int(f[2])]
		var n := (c - a).cross(b - a).normalized()
		st.set_normal(n)
		st.add_vertex(a)
		st.set_normal(n)
		st.add_vertex(b)
		st.set_normal(n)
		st.add_vertex(c)
	return st.commit()

func _build_disc_mesh(sides: int = 12) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var segs := maxi(3, sides)
	for i in range(segs):
		var a0 := TAU * float(i) / float(segs)
		var a1 := TAU * float((i + 1) % segs) / float(segs)
		var p0 := Vector3.ZERO
		var p1 := Vector3(cos(a0), 0.0, sin(a0))
		var p2 := Vector3(cos(a1), 0.0, sin(a1))
		st.set_normal(Vector3.UP)
		st.add_vertex(p0)
		st.set_normal(Vector3.UP)
		st.add_vertex(p1)
		st.set_normal(Vector3.UP)
		st.add_vertex(p2)
	return st.commit()

func resolve_mesh(mesh_spec: Variant) -> Mesh:
	if mesh_spec is Mesh:
		return mesh_spec as Mesh
	return get_primitive_mesh(str(mesh_spec))

func create_material(blend: String = "opaque", col: Color = Color.WHITE, unlit: float = 0.0, use_vertex_color: bool = false) -> StandardMaterial3D:
	var mat := StandardMaterial3D.new()
	mat.roughness = 0.92
	mat.metallic = 0.0
	mat.vertex_color_use_as_albedo = use_vertex_color
	mat.albedo_color = Color.WHITE if use_vertex_color else col
	var mode := blend.to_lower()
	if mode == "additive":
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	elif mode == "alpha":
		mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
		mat.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		if unlit >= 0.85:
			mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	else:
		mat.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
		mat.blend_mode = BaseMaterial3D.BLEND_MODE_MIX
		if unlit >= 0.85:
			mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if unlit > 0.02 and mat.shading_mode != BaseMaterial3D.SHADING_MODE_UNSHADED and not use_vertex_color:
		mat.emission_enabled = true
		mat.emission = Color(col.r, col.g, col.b, 1.0)
		mat.emission_energy_multiplier = unlit
	return mat

func create_batch(mesh_spec: Variant, blend: String = "opaque", capacity: int = 64, is_unlit: bool = false, parent_node: Node = null) -> InstancedBatch:
	var m := resolve_mesh(mesh_spec)
	var mat := create_material(blend, Color.WHITE, 1.0 if is_unlit else 0.0, true)
	var target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
	var batch := InstancedBatch.new(m, mat, blend.to_lower(), is_unlit, capacity, target_parent)
	_batches.append(batch)
	return batch

func create_mesh_pool(mesh_spec: Variant, blend: String = "opaque", unlit_val: float = 0.0, parent_node: Node = null) -> MeshInstancePool:
	var m := resolve_mesh(mesh_spec)
	var mat := create_material(blend, Color.WHITE, unlit_val, false)
	var target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
	var pool := MeshInstancePool.new(m, mat, blend.to_lower(), unlit_val, target_parent)
	_pools.append(pool)
	return pool

# ==============================================================================
# HIERARCHICAL RIG & ANIMATION BRIDGE (matches framework/animation.ts createRig)
# ==============================================================================

func create_rig(joint_defs: Array, parent_node: Node = null) -> RigInstance:
	var target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
	var rig := RigInstance.new(target_parent)
	var by_id: Dictionary = {}
	for jd_val in joint_defs:
		if jd_val is Dictionary:
			var jd: Dictionary = jd_val as Dictionary
			var jid := str(jd.get("id", ""))
			if jid != "" and not by_id.has(jid):
				by_id[jid] = jd

	var visited: Dictionary = {}
	var topo: Array[String] = []
	for jid_key in by_id.keys():
		_visit_rig_joint(str(jid_key), by_id, visited, topo)

	for jid in topo:
		var jd: Dictionary = by_id[jid] as Dictionary
		var pid := str(jd.get("parent", ""))
		var jnode := Node3D.new()
		jnode.name = sanitize_asset_name(jid)
		var piv := _to_vec3(jd.get("pivot", Vector3.ZERO), Vector3.ZERO)
		jnode.position = piv
		if pid != "" and rig.joints.has(pid):
			(rig.joints[pid] as Node3D).add_child(jnode)
		else:
			rig.root.add_child(jnode)
			pid = ""
		rig.joints[jid] = jnode
		rig.pivots[jid] = piv
		rig.parent_ids[jid] = pid
		rig.order.append(jid)

		var parts_val = jd.get("parts", [])
		if parts_val is Array:
			for part_val in parts_val as Array:
				if not (part_val is Dictionary):
					continue
				var part: Dictionary = part_val as Dictionary
				var part_pos := _to_vec3(part.get("position", Vector3.ZERO), Vector3.ZERO)
				var part_scl := _to_scale_vec3(part.get("scale", Vector3.ONE), Vector3.ONE)
				var part_rot := InstancedBatch._coerce_quat(part.get("rotation", Quaternion.IDENTITY))
				if part.has("model"):
					var spawned := spawn_model(str(part["model"]), part_pos, jnode)
					if spawned:
						spawned.quaternion = part_rot
						spawned.scale = part_scl
				else:
					var mi := MeshInstance3D.new()
					mi.mesh = resolve_mesh(part.get("mesh", "box"))
					var col := _to_color(part.get("color", Color.WHITE), Color.WHITE)
					var blend := str(part.get("blend", "opaque"))
					var unlit_v := float(part.get("unlit", 0.0))
					mi.material_override = create_material(blend, col, unlit_v, false)
					mi.position = part_pos
					mi.quaternion = part_rot
					mi.scale = part_scl
					jnode.add_child(mi)

	rig.apply_poses({})
	_rigs.append(rig)
	return rig

func _visit_rig_joint(jid: String, by_id: Dictionary, visited: Dictionary, topo: Array[String]) -> void:
	var state := int(visited.get(jid, 0))
	if state == 2 or state == 1:
		return
	visited[jid] = 1
	var jd: Dictionary = by_id[jid] as Dictionary
	var pid := str(jd.get("parent", ""))
	if pid != "" and by_id.has(pid):
		_visit_rig_joint(pid, by_id, visited, topo)
	visited[jid] = 2
	topo.append(jid)

# ==============================================================================
# POOLED 3D PARTICLE BRIDGE (matches framework/animation.ts createParticles)
# ==============================================================================

func create_particles(max_particles: int = 240, parent_node: Node = null) -> ParticleSystem:
	var target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
	var ps := ParticleSystem.new(self, max_particles, target_parent)
	_particle_systems.append(ps)
	return ps

# ==============================================================================
# MULTI-BUS SOUNDSCAPE & AUDIO BRIDGE (Master, Music, SFX, Ambience)
# ==============================================================================

func ensure_audio_buses() -> void:
	for bus_name in ["Music", "SFX", "Ambience"]:
		if AudioServer.get_bus_index(bus_name) < 0:
			var idx := AudioServer.bus_count
			AudioServer.add_bus(idx)
			AudioServer.set_bus_name(idx, bus_name)
			AudioServer.set_bus_send(idx, "Master")

	var music_idx := AudioServer.get_bus_index("Music")
	if music_idx >= 0:
		if AudioServer.get_bus_effect_count(music_idx) == 0:
			_music_filter = AudioEffectLowPassFilter.new()
			_music_filter.cutoff_hz = 1800.0
			AudioServer.add_bus_effect(music_idx, _music_filter)
		elif AudioServer.get_bus_effect(music_idx, 0) is AudioEffectLowPassFilter:
			_music_filter = AudioServer.get_bus_effect(music_idx, 0) as AudioEffectLowPassFilter

	var amb_idx := AudioServer.get_bus_index("Ambience")
	if amb_idx >= 0:
		if AudioServer.get_bus_effect_count(amb_idx) == 0:
			_ambience_filter = AudioEffectLowPassFilter.new()
			_ambience_filter.cutoff_hz = 2400.0
			AudioServer.add_bus_effect(amb_idx, _ambience_filter)
		elif AudioServer.get_bus_effect(amb_idx, 0) is AudioEffectLowPassFilter:
			_ambience_filter = AudioServer.get_bus_effect(amb_idx, 0) as AudioEffectLowPassFilter

	set_bus_volume("Master", master_volume if sound_enabled else 0.0)
	set_bus_volume("Music", music_volume if (sound_enabled and music_enabled) else 0.0)
	set_bus_volume("SFX", sfx_volume)
	set_bus_volume("Ambience", ambience_volume)

func set_bus_volume(bus_name: String, linear: float) -> void:
	var idx := AudioServer.get_bus_index(bus_name)
	if idx < 0:
		return
	var v := clampf(linear, 0.0, 2.0)
	if v <= 0.0005:
		AudioServer.set_bus_mute(idx, true)
		AudioServer.set_bus_volume_db(idx, -80.0)
	else:
		AudioServer.set_bus_mute(idx, false)
		AudioServer.set_bus_volume_db(idx, linear_to_db(v))

func set_muted(muted: bool) -> void:
	sound_enabled = not muted
	var master_idx := AudioServer.get_bus_index("Master")
	if master_idx >= 0:
		AudioServer.set_bus_mute(master_idx, muted)
		if not muted:
			AudioServer.set_bus_volume_db(master_idx, linear_to_db(maxf(0.001, master_volume)))

func is_muted() -> bool:
	return not sound_enabled

func set_music_enabled(enabled: bool) -> void:
	music_enabled = enabled
	set_bus_volume("Music", music_volume if (sound_enabled and music_enabled) else 0.0)

func is_music_enabled() -> bool:
	return music_enabled

func set_music_volume(linear: float) -> void:
	music_volume = maxf(0.0, linear)
	set_bus_volume("Music", music_volume if (sound_enabled and music_enabled) else 0.0)

func set_music_filter(cutoff_hz: float) -> void:
	if _music_filter:
		_music_filter.cutoff_hz = clampf(cutoff_hz, 40.0, 20000.0)

func set_ambience_volume(linear: float) -> void:
	ambience_volume = maxf(0.0, linear)
	set_bus_volume("Ambience", ambience_volume)

func set_ambience_filter(cutoff_hz: float) -> void:
	if _ambience_filter:
		_ambience_filter.cutoff_hz = clampf(cutoff_hz, 40.0, 20000.0)

func _get_pink_noise_stream() -> AudioStreamWAV:
	if _pink_noise_stream != null:
		return _pink_noise_stream
	var sample_rate := 22050
	var count := 11025
	var bytes := PackedByteArray()
	bytes.resize(count * 2)
	var b0 := 0.0
	var b1 := 0.0
	var b2 := 0.0
	var rng := RandomNumberGenerator.new()
	rng.seed = 4201337
	for i in range(count):
		var white := rng.randf_range(-1.0, 1.0)
		b0 = 0.997 * b0 + white * 0.029
		b1 = 0.985 * b1 + white * 0.032
		b2 = 0.950 * b2 + white * 0.048
		var sample := clampf((b0 + b1 + b2 + white * 0.18) * 0.55, -1.0, 1.0)
		bytes.encode_s16(i * 2, int(round(sample * 32767.0)))
	var wav := AudioStreamWAV.new()
	wav.format = AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate = sample_rate
	wav.stereo = false
	wav.loop_mode = AudioStreamWAV.LOOP_FORWARD
	wav.loop_begin = 0
	wav.loop_end = count
	wav.data = bytes
	_pink_noise_stream = wav
	return wav

func register_ambient_bed(bed_id: String, opts: Dictionary = {}) -> void:
	var safe_id := sanitize_asset_name(bed_id)
	if safe_id == "":
		return
	var bus_name := "AmbBed_" + safe_id
	var filter_type := str(opts.get("type", "lowpass")).to_lower()
	var freq := clampf(float(opts.get("frequency", 420.0)), 20.0, 20000.0)
	var q_val := clampf(float(opts.get("q", 0.7)), 0.1, 4.0)
	var gain := clampf(float(opts.get("gain", 0.0)), 0.0, 2.0)

	var bus_idx := AudioServer.get_bus_index(bus_name)
	if bus_idx < 0:
		bus_idx = AudioServer.bus_count
		AudioServer.add_bus(bus_idx)
		AudioServer.set_bus_name(bus_idx, bus_name)
		AudioServer.set_bus_send(bus_idx, "Ambience")

	var filter_fx: AudioEffectFilter = null
	if AudioServer.get_bus_effect_count(bus_idx) > 0 and AudioServer.get_bus_effect(bus_idx, 0) is AudioEffectFilter:
		filter_fx = AudioServer.get_bus_effect(bus_idx, 0) as AudioEffectFilter
	else:
		if filter_type == "bandpass":
			filter_fx = AudioEffectBandPassFilter.new()
		elif filter_type == "highpass":
			filter_fx = AudioEffectHighPassFilter.new()
		else:
			filter_fx = AudioEffectLowPassFilter.new()
		AudioServer.add_bus_effect(bus_idx, filter_fx)
	filter_fx.cutoff_hz = freq
	filter_fx.resonance = q_val

	var player: AudioStreamPlayer
	if ambient_beds.has(bed_id):
		var existing: Dictionary = ambient_beds[bed_id] as Dictionary
		player = existing["player"] as AudioStreamPlayer
	else:
		player = AudioStreamPlayer.new()
		player.name = "AmbBedPlayer_" + safe_id
		player.bus = bus_name
		add_child(player)

	var stream: AudioStream = null
	if opts.has("clip"):
		stream = load_audio(str(opts["clip"]))
	if stream == null:
		stream = _get_pink_noise_stream()
	player.stream = stream

	ambient_beds[bed_id] = {
		"player": player,
		"bus": bus_name,
		"filter": filter_fx,
		"type": filter_type,
		"frequency": freq,
		"gain": gain
	}
	set_ambient_bed(bed_id, { "gain": gain, "frequency": freq })

func _audio_output_active() -> bool:
	# Godot's headless Dummy audio driver never runs mix_step() to reap stopped AudioStreamPlaybacks,
	# which causes leaked AudioStreamPlaybackWAV warnings on exit. Route/decode/configure everything
	# normally, and start actual stream playback only on live mixing audio drivers.
	return AudioServer.get_driver_name() != "Dummy"

func set_ambient_bed(bed_id: String, opts: Dictionary) -> void:
	if not ambient_beds.has(bed_id):
		register_ambient_bed(bed_id, opts)
		return
	var bed: Dictionary = ambient_beds[bed_id] as Dictionary
	var player: AudioStreamPlayer = bed["player"] as AudioStreamPlayer
	var filter_fx: AudioEffectFilter = bed["filter"] as AudioEffectFilter
	if opts.has("frequency"):
		var f := clampf(float(opts["frequency"]), 20.0, 20000.0)
		bed["frequency"] = f
		if filter_fx:
			filter_fx.cutoff_hz = f
	if opts.has("gain"):
		var g := clampf(float(opts["gain"]), 0.0, 2.0)
		bed["gain"] = g
		bed["active"] = g > 0.0005
		if player and is_instance_valid(player):
			if g <= 0.0005:
				player.volume_db = -80.0
				if player.playing:
					player.stop()
			else:
				player.volume_db = linear_to_db(g)
				if _audio_output_active() and not player.playing and player.stream != null:
					player.play()

func get_ambient_bed(bed_id: String) -> Dictionary:
	if ambient_beds.has(bed_id):
		return ambient_beds[bed_id] as Dictionary
	return {}

func load_audio(clip_name: String) -> AudioStream:
	var safe := sanitize_asset_name(clip_name)
	if audio_cache.has(safe):
		return audio_cache[safe] as AudioStream
	var path := "res://assets/audio/%s.wav" % safe
	if ResourceLoader.exists(path):
		var stream = load(path)
		if stream is AudioStream:
			audio_cache[safe] = stream
			return stream as AudioStream
	if FileAccess.file_exists(path):
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.size() > 44:
			var wav := AudioStreamWAV.new()
			wav.format = AudioStreamWAV.FORMAT_16_BITS
			wav.mix_rate = bytes.decode_u32(24)
			wav.stereo = bytes.decode_u16(22) == 2
			wav.data = bytes.slice(44)
			audio_cache[safe] = wav
			return wav
	return null

func play_sfx(clip_name: String, volume: float = 1.0, pitch: float = 1.0, bus_name: String = "SFX") -> bool:
	if not sound_enabled or sfx_players.is_empty():
		return false
	var stream := load_audio(clip_name)
	if stream == null:
		return false
	var player: AudioStreamPlayer = null
	for p in sfx_players:
		if not p.playing:
			player = p
			break
	if player == null:
		player = sfx_players[_sfx_cursor % sfx_players.size()]
		_sfx_cursor += 1
	player.bus = bus_name if AudioServer.get_bus_index(bus_name) >= 0 else "Master"
	player.stream = stream
	player.volume_db = linear_to_db(maxf(0.0005, volume))
	player.pitch_scale = clampf(pitch, 0.1, 4.0)
	if _audio_output_active():
		player.play()
	return true

# ==============================================================================
# MODEL & COMPILED SCRIPT LOADING HELPERS
# ==============================================================================

func sanitize_asset_name(raw_name: String) -> String:
	var out := ""
	var prev_dash := false
	for i in range(raw_name.length()):
		var code := raw_name.unicode_at(i)
		var ok := (code >= 48 and code <= 57) or (code >= 65 and code <= 90) or (code >= 97 and code <= 122) or code == 45 or code == 95
		if ok:
			out += raw_name.substr(i, 1)
			prev_dash = false
		elif not prev_dash:
			out += "-"
			prev_dash = true
	return out

func _enable_vertex_colors(node: Node) -> void:
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		if mi.mesh is ArrayMesh:
			var am := mi.mesh as ArrayMesh
			for s in range(am.get_surface_count()):
				if (am.surface_get_format(s) & Mesh.ARRAY_FORMAT_COLOR) != 0:
					var mat = mi.get_active_material(s)
					if mat is StandardMaterial3D:
						(mat as StandardMaterial3D).vertex_color_use_as_albedo = true
	for child in node.get_children():
		_enable_vertex_colors(child)

func load_model_template(model_name: String) -> Variant:
	var safe := sanitize_asset_name(model_name)
	if models_cache.has(safe):
		return models_cache[safe]
	var path := "res://assets/models/%s.glb" % safe
	if ResourceLoader.exists(path):
		var packed = load(path)
		if packed is PackedScene:
			models_cache[safe] = packed
			return packed
	# Runtime GLTF loader fallback so fresh exports work immediately without Godot editor --import.
	if FileAccess.file_exists(path):
		var bytes := FileAccess.get_file_as_bytes(path)
		if bytes.size() > 0:
			var doc := GLTFDocument.new()
			var state := GLTFState.new()
			if doc.append_from_buffer(bytes, "", state) == OK:
				var scene := doc.generate_scene(state)
				if scene is Node3D:
					_enable_vertex_colors(scene)
					models_cache[safe] = scene
					return scene
	return null

func spawn_model(model_name: String, pos: Vector3 = Vector3.ZERO, parent_node: Node = null) -> Node3D:
	var tpl = load_model_template(model_name)
	if tpl == null:
		return null
	var node: Node3D = null
	if tpl is PackedScene:
		node = (tpl as PackedScene).instantiate() as Node3D
	elif tpl is Node3D:
		node = (tpl as Node3D).duplicate() as Node3D
	if node:
		node.position = pos
		var target_parent: Node = parent_node if parent_node != null else (host_root if host_root != null else self)
		target_parent.add_child(node)
	return node

func load_compiled_module(mod_path: String) -> Object:
	var res_path := mod_path if mod_path.begins_with("res://") else ("res://scripts/compiled/" + mod_path.trim_prefix("/"))
	if not ResourceLoader.exists(res_path):
		return null
	if rt_script != null:
		return rt_script.mod(res_path)
	var script = load(res_path)
	if script is GDScript:
		var inst = (script as GDScript).new()
		if inst != null and inst.has_method("__init_module"):
			inst.__init_module()
		return inst
	return null

func list_compiled_modules() -> Array[String]:
	var out: Array[String] = []
	_scan_compiled_dir("res://scripts/compiled", out)
	return out

func _scan_compiled_dir(dir_path: String, out: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry := dir.get_next()
	while entry != "":
		if not entry.begins_with("."):
			var full := dir_path + "/" + entry
			if dir.current_is_dir():
				_scan_compiled_dir(full, out)
			elif entry.ends_with(".gd") and full != "res://scripts/compiled/rt.gd":
				out.append(full)
		entry = dir.get_next()
	dir.list_dir_end()
