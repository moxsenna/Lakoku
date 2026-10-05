import bcrypt from 'bcryptjs'

export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10)
  return bcrypt.hash(password, salt)
}

export async function verifyPassword({ password, hash }: { password: string; hash: string }): Promise<boolean> {
  if (!hash || !password) return false
  return bcrypt.compare(password, hash)
}
