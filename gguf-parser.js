/**
 * GGUF binary format parser and writer
 * Spec: revised const in gguf-connector
 */

const GGUF_MAGIC = 0x46554747; // "GGUF" in little-endian

const GGUFValueType = {
  UINT8:   0,
  INT8:    1,
  UINT16:  2,
  INT16:   3,
  UINT32:  4,
  INT32:   5,
  FLOAT32: 6,
  BOOL:    7,
  STRING:  8,
  ARRAY:   9,
  UINT64:  10,
  INT64:   11,
  FLOAT64: 12,
};

const GGUFValueTypeName = {
  0: 'UINT8', 1: 'INT8', 2: 'UINT16', 3: 'INT16',
  4: 'UINT32', 5: 'INT32', 6: 'FLOAT32', 7: 'BOOL',
  8: 'STRING', 9: 'ARRAY', 10: 'UINT64', 11: 'INT64', 12: 'FLOAT64',
};

const GGMLQuantizationType = {
  0:'F32',1:'F16',2:'Q4_0',3:'Q4_1',6:'Q5_0',
  7:'Q5_1',8:'Q8_0',9:'Q8_1',10:'Q2_K',
  11:'Q3_K',12:'Q4_K',13:'Q5_K',14:'Q6_K ',
  15:'Q8_K',16:'IQ2_XXS',17:'IQ2_XS',18:'IQ3_XXS',
  19:'IQ1_S',20:'IQ4_NL',21:'IQ3_S',22:'IQ2_S',
  23:'IQ4_XS',24:'I8',25:'I16',26:'I32',27:'I64',
  28:'F64',29:'IQ1_M',30:'BF16',34:'TQ1_0',35:'TQ2_0',
  39:'MXFP4',
};

// ─── Parser ──────────────────────────────────────────────────────────────────

class GGUFReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = 0;
    this.le = true; // little-endian
    this.decoder = new TextDecoder('utf-8');
  }

  readUint8()   { const v = this.view.getUint8(this.offset);           this.offset += 1; return v; }
  readInt8()    { const v = this.view.getInt8(this.offset);            this.offset += 1; return v; }
  readUint16()  { const v = this.view.getUint16(this.offset, this.le); this.offset += 2; return v; }
  readInt16()   { const v = this.view.getInt16(this.offset, this.le);  this.offset += 2; return v; }
  readUint32()  { const v = this.view.getUint32(this.offset, this.le); this.offset += 4; return v; }
  readInt32()   { const v = this.view.getInt32(this.offset, this.le);  this.offset += 4; return v; }
  readFloat32() { const v = this.view.getFloat32(this.offset, this.le);this.offset += 4; return v; }
  readFloat64() { const v = this.view.getFloat64(this.offset, this.le);this.offset += 8; return v; }
  readBool()    { return this.readUint8() !== 0; }

  readUint64() {
    const lo = this.view.getUint32(this.offset, this.le);
    const hi = this.view.getUint32(this.offset + 4, this.le);
    this.offset += 8;
    return BigInt(hi) * 0x100000000n + BigInt(lo);
  }

  readInt64() {
    const lo = this.view.getUint32(this.offset, this.le);
    const hi = this.view.getInt32(this.offset + 4, this.le);
    this.offset += 8;
    return BigInt(hi) * 0x100000000n + BigInt(lo);
  }

  readString() {
    const len = Number(this.readUint64());
    const bytes = new Uint8Array(this.buffer, this.offset, len);
    this.offset += len;
    return this.decoder.decode(bytes);
  }

  readValue(type) {
    switch (type) {
      case GGUFValueType.UINT8:   return this.readUint8();
      case GGUFValueType.INT8:    return this.readInt8();
      case GGUFValueType.UINT16:  return this.readUint16();
      case GGUFValueType.INT16:   return this.readInt16();
      case GGUFValueType.UINT32:  return this.readUint32();
      case GGUFValueType.INT32:   return this.readInt32();
      case GGUFValueType.FLOAT32: return this.readFloat32();
      case GGUFValueType.BOOL:    return this.readBool();
      case GGUFValueType.STRING:  return this.readString();
      case GGUFValueType.ARRAY: {
        const elemType = this.readUint32();
        const count = Number(this.readUint64());
        const items = [];
        for (let i = 0; i < count; i++) items.push(this.readValue(elemType));
        return { _isArray: true, elemType, items };
      }
      case GGUFValueType.UINT64:  return this.readUint64();
      case GGUFValueType.INT64:   return this.readInt64();
      case GGUFValueType.FLOAT64: return this.readFloat64();
      default: throw new Error(`Unknown GGUF value type: ${type}`);
    }
  }

  parse() {
    const magic = this.readUint32();
    if (magic !== GGUF_MAGIC) throw new Error('Invalid GGUF file (bad magic bytes)');

    const version = this.readUint32();
    if (version < 1 || version > 3) throw new Error(`Unsupported GGUF version: ${version}`);

    const tensorCount    = this.readUint64();
    const metadataCount  = this.readUint64();

    // Metadata key-value pairs
    const metadata = {};
    for (let i = 0; i < Number(metadataCount); i++) {
      const key  = this.readString();
      const type = this.readUint32();
      const value = this.readValue(type);
      metadata[key] = { type, value };
    }

    // Tensor info
    const tensorInfos = [];
    for (let i = 0; i < Number(tensorCount); i++) {
      const name   = this.readString();
      const nDims  = this.readUint32();
      const shape  = [];
      for (let d = 0; d < nDims; d++) shape.push(Number(this.readUint64()));
      const dtype  = this.readUint32();
      const offset = this.readUint64(); // offset within tensor data section
      tensorInfos.push({ name, shape, dtype, offset });
    }

    // Tensor data starts at next alignment boundary (default 32 bytes)
    const ALIGNMENT = 32;
    const tensorDataOffset = Math.ceil(this.offset / ALIGNMENT) * ALIGNMENT;

    return { version, metadata, tensorInfos, tensorDataOffset };
  }
}

// ─── Writer ──────────────────────────────────────────────────────────────────

class GGUFWriter {
  constructor() {
    this.chunks = [];
    this.encoder = new TextEncoder();
  }

  _push(arr) { this.chunks.push(arr instanceof Uint8Array ? arr : new Uint8Array(arr)); }

  writeUint8(v)  { const b = new Uint8Array(1);  new DataView(b.buffer).setUint8(0, v);            this._push(b); }
  writeInt8(v)   { const b = new Uint8Array(1);  new DataView(b.buffer).setInt8(0, v);             this._push(b); }
  writeUint16(v) { const b = new Uint8Array(2);  new DataView(b.buffer).setUint16(0, v, true);     this._push(b); }
  writeInt16(v)  { const b = new Uint8Array(2);  new DataView(b.buffer).setInt16(0, v, true);      this._push(b); }
  writeUint32(v) { const b = new Uint8Array(4);  new DataView(b.buffer).setUint32(0, v, true);     this._push(b); }
  writeInt32(v)  { const b = new Uint8Array(4);  new DataView(b.buffer).setInt32(0, v, true);      this._push(b); }
  writeFloat32(v){ const b = new Uint8Array(4);  new DataView(b.buffer).setFloat32(0, v, true);    this._push(b); }
  writeFloat64(v){ const b = new Uint8Array(8);  new DataView(b.buffer).setFloat64(0, v, true);    this._push(b); }
  writeBool(v)   { this.writeUint8(v ? 1 : 0); }

  writeUint64(v) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    const big = BigInt(v);
    dv.setUint32(0, Number(big & 0xFFFFFFFFn), true);
    dv.setUint32(4, Number(big >> 32n), true);
    this._push(b);
  }

  writeInt64(v) {
    const b = new Uint8Array(8);
    const dv = new DataView(b.buffer);
    const big = BigInt(v);
    dv.setUint32(0, Number(big & 0xFFFFFFFFn), true);
    dv.setInt32(4, Number(big >> 32n), true);
    this._push(b);
  }

  writeString(s) {
    const encoded = this.encoder.encode(s);
    this.writeUint64(BigInt(encoded.length));
    this._push(encoded);
  }

  writeValue(type, value) {
    switch (type) {
      case GGUFValueType.UINT8:   this.writeUint8(value);   break;
      case GGUFValueType.INT8:    this.writeInt8(value);    break;
      case GGUFValueType.UINT16:  this.writeUint16(value);  break;
      case GGUFValueType.INT16:   this.writeInt16(value);   break;
      case GGUFValueType.UINT32:  this.writeUint32(value);  break;
      case GGUFValueType.INT32:   this.writeInt32(value);   break;
      case GGUFValueType.FLOAT32: this.writeFloat32(value); break;
      case GGUFValueType.BOOL:    this.writeBool(value);    break;
      case GGUFValueType.STRING:  this.writeString(value);  break;
      case GGUFValueType.ARRAY:
        this.writeUint32(value.elemType);
        this.writeUint64(BigInt(value.items.length));
        for (const item of value.items) this.writeValue(value.elemType, item);
        break;
      case GGUFValueType.UINT64:  this.writeUint64(value);  break;
      case GGUFValueType.INT64:   this.writeInt64(value);   break;
      case GGUFValueType.FLOAT64: this.writeFloat64(value); break;
      default: throw new Error(`Unknown type: ${type}`);
    }
  }

  build() {
    const total = this.chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const chunk of this.chunks) { out.set(chunk, pos); pos += chunk.length; }
    return out;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse an ArrayBuffer containing a GGUF file.
 * Returns { version, metadata, tensorInfos, tensorDataOffset }
 */
function parseGGUF(buffer) {
  return new GGUFReader(buffer).parse();
}

/**
 * Rebuild a GGUF file with updated metadata values and tensor names.
 *
 * @param {ArrayBuffer} originalBuffer  - Original file bytes
 * @param {object}      parsedData      - Result of parseGGUF()
 * @param {object}      editedMetadata  - Map of key -> new string value (for editable keys)
 * @param {string[]}    editedTensorNames - New name for each tensor (parallel to tensorInfos)
 * @param {Set<number>} deletedTensors  - Indices of tensors to remove
 * @returns {Uint8Array} New file bytes
 */
function buildGGUF(originalBuffer, parsedData, editedMetadata, editedTensorNames, deletedTensors) {
  const { version, metadata, tensorInfos, tensorDataOffset } = parsedData;

  // Build updated metadata
  const updatedMetadata = {};
  for (const [key, entry] of Object.entries(metadata)) {
    if (key in editedMetadata) {
      // Parse the user's edited string back to the correct type
      const newValue = parseEditedValue(entry.type, entry.value, editedMetadata[key]);
      updatedMetadata[key] = { type: entry.type, value: newValue };
    } else {
      updatedMetadata[key] = entry;
    }
  }

  // Build filtered tensor list
  const filteredTensors = tensorInfos
    .map((t, i) => ({ ...t, name: editedTensorNames[i] ?? t.name, originalIndex: i }))
    .filter((_, i) => !deletedTensors.has(i));

  // Write header
  const w = new GGUFWriter();
  w.writeUint32(GGUF_MAGIC);
  w.writeUint32(version);
  w.writeUint64(BigInt(filteredTensors.length));
  w.writeUint64(BigInt(Object.keys(updatedMetadata).length));

  for (const [key, { type, value }] of Object.entries(updatedMetadata)) {
    w.writeString(key);
    w.writeUint32(type);
    w.writeValue(type, value);
  }

  for (const tensor of filteredTensors) {
    w.writeString(tensor.name);
    w.writeUint32(tensor.shape.length);
    for (const dim of tensor.shape) w.writeUint64(BigInt(dim));
    w.writeUint32(tensor.dtype);
    w.writeUint64(tensor.offset);
  }

  const header = w.build();

  // Pad to 32-byte alignment
  const ALIGNMENT = 32;
  const paddedLen = Math.ceil(header.length / ALIGNMENT) * ALIGNMENT;
  const padded = new Uint8Array(paddedLen);
  padded.set(header);

  // Append original tensor data unchanged
  const tensorData = new Uint8Array(originalBuffer, tensorDataOffset);
  const result = new Uint8Array(paddedLen + tensorData.length);
  result.set(padded, 0);
  result.set(tensorData, paddedLen);

  return result;
}

/**
 * Attempt to parse a user-edited string back into the original value type.
 */
function parseEditedValue(type, originalValue, editedStr) {
  try {
    switch (type) {
      case GGUFValueType.STRING:  return editedStr;
      case GGUFValueType.BOOL:    return editedStr.trim().toLowerCase() === 'true';
      case GGUFValueType.FLOAT32:
      case GGUFValueType.FLOAT64: return parseFloat(editedStr);
      case GGUFValueType.UINT64:
      case GGUFValueType.INT64:   return BigInt(editedStr.trim());
      case GGUFValueType.ARRAY:   return originalValue; // arrays not editable
      default:                    return Number(editedStr);
    }
  } catch {
    return originalValue; // fall back to original on parse error
  }
}

// ─── Display helpers ─────────────────────────────────────────────────────────

function formatValue(type, value, maxArrayElements = 25) {
  if (type === GGUFValueType.ARRAY) {
    const { elemType, items } = value;
    const shown = items.slice(0, maxArrayElements).map(v => formatValue(elemType, v));
    const more = items.length > maxArrayElements ? `, … (+${items.length - maxArrayElements})` : '';
    return `[${shown.join(', ')}${more}]`;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && !Number.isInteger(value)) return value.toPrecision(7);
  return String(value);
}

function isEditableType(type) {
  return type !== GGUFValueType.ARRAY;
}

function quantizationName(dtype) {
  return GGMLQuantizationType[dtype] ?? `Unknown(${dtype})`;
}
