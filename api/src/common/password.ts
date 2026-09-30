/** scrypt password hashes (node:crypto, no native addon): `scrypt$N$r$p$salt$hash`. */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto"

const scrypt = (pw: string, salt: Buffer, len: number, o: ScryptOptions) =>
  new Promise<Buffer>((res, rej) => scryptCb(pw, salt, len, o, (e, k) => (e ? rej(e) : res(k))))

const N = 16384, R = 8, P = 1, LEN = 32

export async function hashPassword(pw: string) {
  const salt = randomBytes(16)
  const key = await scrypt(pw, salt, LEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`
}

export async function verifyPassword(pw: string, stored: string | null | undefined) {
  const parts = (stored ?? "").split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    await hashPassword(pw) // same cost for unknown users — no timing oracle
    return false
  }
  const [, n, r, p, salt, hash] = parts
  const want = Buffer.from(hash, "base64url")
  const got = await scrypt(pw, Buffer.from(salt, "base64url"), want.length, { N: Number(n), r: Number(r), p: Number(p) })
  return timingSafeEqual(got, want)
}
