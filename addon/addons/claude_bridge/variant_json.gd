@tool
extends RefCounted
## Variant <-> JSON codec.
##
## JSON can only carry null/bool/number/string/array/object. Godot's rich value
## types (Vector*, Color, Rect2, NodePath, Quaternion, ...) are encoded as tagged
## objects: {"__type__": "Vector3", "x": .., "y": .., "z": ..}. `decode()` turns
## those tags back into real Variants so property set/get round-trips correctly.


static func encode(v: Variant) -> Variant:
	var t := typeof(v)
	match t:
		TYPE_NIL, TYPE_BOOL, TYPE_INT, TYPE_FLOAT:
			return v
		TYPE_STRING:
			return v
		TYPE_STRING_NAME:
			return String(v)
		TYPE_NODE_PATH:
			return {"__type__": "NodePath", "path": String(v)}
		TYPE_VECTOR2:
			return {"__type__": "Vector2", "x": v.x, "y": v.y}
		TYPE_VECTOR2I:
			return {"__type__": "Vector2i", "x": v.x, "y": v.y}
		TYPE_VECTOR3:
			return {"__type__": "Vector3", "x": v.x, "y": v.y, "z": v.z}
		TYPE_VECTOR3I:
			return {"__type__": "Vector3i", "x": v.x, "y": v.y, "z": v.z}
		TYPE_VECTOR4:
			return {"__type__": "Vector4", "x": v.x, "y": v.y, "z": v.z, "w": v.w}
		TYPE_COLOR:
			return {"__type__": "Color", "r": v.r, "g": v.g, "b": v.b, "a": v.a}
		TYPE_RECT2:
			return {
				"__type__": "Rect2",
				"x": v.position.x, "y": v.position.y,
				"w": v.size.x, "h": v.size.y,
			}
		TYPE_QUATERNION:
			return {"__type__": "Quaternion", "x": v.x, "y": v.y, "z": v.z, "w": v.w}
		TYPE_DICTIONARY:
			var out := {}
			for k in v:
				out[String(k)] = encode(v[k])
			return out
		TYPE_ARRAY, TYPE_PACKED_INT32_ARRAY, TYPE_PACKED_INT64_ARRAY, \
		TYPE_PACKED_FLOAT32_ARRAY, TYPE_PACKED_FLOAT64_ARRAY, \
		TYPE_PACKED_STRING_ARRAY, TYPE_PACKED_VECTOR2_ARRAY, \
		TYPE_PACKED_VECTOR3_ARRAY, TYPE_PACKED_COLOR_ARRAY:
			var arr := []
			for item in v:
				arr.append(encode(item))
			return arr
		TYPE_OBJECT:
			if v == null:
				return null
			if v is Resource:
				return {
					"__type__": "Resource",
					"class": v.get_class(),
					"path": v.resource_path,
				}
			return {"__type__": "Object", "class": v.get_class()}
		_:
			# Fallback: best-effort string representation for unhandled types.
			return {"__type__": "Unsupported", "repr": str(v), "type_id": t}


static func decode(j: Variant) -> Variant:
	if typeof(j) == TYPE_DICTIONARY:
		if j.has("__type__"):
			match String(j["__type__"]):
				"NodePath":
					return NodePath(String(j.get("path", "")))
				"Vector2":
					return Vector2(j.get("x", 0.0), j.get("y", 0.0))
				"Vector2i":
					return Vector2i(int(j.get("x", 0)), int(j.get("y", 0)))
				"Vector3":
					return Vector3(j.get("x", 0.0), j.get("y", 0.0), j.get("z", 0.0))
				"Vector3i":
					return Vector3i(int(j.get("x", 0)), int(j.get("y", 0)), int(j.get("z", 0)))
				"Vector4":
					return Vector4(j.get("x", 0.0), j.get("y", 0.0), j.get("z", 0.0), j.get("w", 0.0))
				"Color":
					return Color(j.get("r", 0.0), j.get("g", 0.0), j.get("b", 0.0), j.get("a", 1.0))
				"Rect2":
					return Rect2(j.get("x", 0.0), j.get("y", 0.0), j.get("w", 0.0), j.get("h", 0.0))
				"Quaternion":
					return Quaternion(j.get("x", 0.0), j.get("y", 0.0), j.get("z", 0.0), j.get("w", 1.0))
				"Resource":
					var path := String(j.get("path", ""))
					if path != "" and ResourceLoader.exists(path):
						return ResourceLoader.load(path)
					return null
				_:
					return null
		var out := {}
		for k in j:
			out[k] = decode(j[k])
		return out
	elif typeof(j) == TYPE_ARRAY:
		var arr := []
		for item in j:
			arr.append(decode(item))
		return arr
	return j
