import Foundation

/// A JSON value of no particular shape.
///
/// The generated protocol (`Generated/InkblotCore.swift`) reaches for this in exactly
/// the places the format is genuinely untyped — TipTap document content, a canvas as it
/// sits on disk, and the unknown-key maps the core preserves so that a round trip does
/// not drop fields a newer build wrote. See `typeshare.toml`.
///
/// Written here rather than taken from a package because what is needed is small and
/// exact: it must decode anything JSON can say, re-encode it without changing it, and
/// compare by value. In particular it keeps integers and floats apart, so a document
/// that said `1` does not come back saying `1.0`.
nonisolated public struct AnyCodable: Codable, Equatable, @unchecked Sendable {
    public let value: Any

    public init(_ value: Any?) {
        self.value = value ?? NSNull()
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let bool = try? container.decode(Bool.self) {
            value = bool
        } else if let int = try? container.decode(Int64.self) {
            value = int
        } else if let double = try? container.decode(Double.self) {
            value = double
        } else if let string = try? container.decode(String.self) {
            value = string
        } else if let array = try? container.decode([AnyCodable].self) {
            value = array.map(\.value)
        } else if let object = try? container.decode([String: AnyCodable].self) {
            value = object.mapValues(\.value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Not a JSON value")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch value {
        case is NSNull:
            try container.encodeNil()
        case let bool as Bool:
            try container.encode(bool)
        case let int as Int64:
            try container.encode(int)
        case let int as Int:
            try container.encode(int)
        case let double as Double:
            try container.encode(double)
        case let string as String:
            try container.encode(string)
        case let array as [Any]:
            try container.encode(array.map(AnyCodable.init))
        case let object as [String: Any]:
            try container.encode(object.mapValues(AnyCodable.init))
        default:
            throw EncodingError.invalidValue(
                value, .init(codingPath: encoder.codingPath, debugDescription: "Not a JSON value"))
        }
    }

    public static func == (lhs: AnyCodable, rhs: AnyCodable) -> Bool {
        switch (lhs.value, rhs.value) {
        case (is NSNull, is NSNull):
            return true
        case let (l as Bool, r as Bool):
            return l == r
        case let (l as Int64, r as Int64):
            return l == r
        case let (l as Int, r as Int):
            return l == r
        case let (l as Double, r as Double):
            return l == r
        case let (l as String, r as String):
            return l == r
        case let (l as [Any], r as [Any]):
            return l.count == r.count && zip(l, r).allSatisfy { AnyCodable($0) == AnyCodable($1) }
        case let (l as [String: Any], r as [String: Any]):
            return l.count == r.count && l.allSatisfy { key, value in
                r[key].map { AnyCodable(value) == AnyCodable($0) } ?? false
            }
        default:
            return false
        }
    }
}
