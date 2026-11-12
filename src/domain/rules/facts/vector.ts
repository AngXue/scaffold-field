import type { Vector3Tuple } from '../../scaffold.ts'
const round = (value: number) => Number(value.toFixed(3))

export class Vector {
  static readonly ZERO = new Vector([0, 0, 0])
  private readonly value: Vector3Tuple

  constructor(value: Vector3Tuple) {
    this.value = value
  }

  add(other: Vector) {
    return new Vector(this.value.map((value, index) => value + other.value[index]) as Vector3Tuple)
  }

  subtract(other: Vector) {
    return new Vector(this.value.map((value, index) => value - other.value[index]) as Vector3Tuple)
  }

  scale(factor: number) {
    return new Vector(this.value.map((value) => value * factor) as Vector3Tuple)
  }

  normalize() {
    const length = Math.hypot(...this.value)
    return length > 0 ? this.scale(1 / length) : Vector.ZERO
  }

  perpendicular() {
    const [x, y, z] = this.value
    const candidate: Vector3Tuple = Math.abs(y) > 0.9 ? [1, 0, 0] : [-z, 0, x]
    return new Vector(candidate).normalize()
  }

  toTuple() {
    return this.value.map((value) => round(value)) as Vector3Tuple
  }
}

