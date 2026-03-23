import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { createUser, findUserByEmail, findUserById } from './db.js'
import type { UserRow } from './db.js'

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production'
const JWT_EXPIRES_IN = '24h'
const SALT_ROUNDS = 10

export interface JwtPayload {
  userId: number
  email: string
}

export async function register(email: string, password: string): Promise<{ token: string; user: { id: number; email: string } }> {
  const existing = findUserByEmail(email)
  if (existing) throw new Error('Email already registered')

  if (password.length < 6) throw new Error('Password must be at least 6 characters')

  const hash = await bcrypt.hash(password, SALT_ROUNDS)
  const user = createUser(email, hash)
  const token = signToken(user)
  return { token, user: { id: user.id, email: user.email } }
}

export async function login(email: string, password: string): Promise<{ token: string; user: { id: number; email: string } }> {
  const user = findUserByEmail(email)
  if (!user) throw new Error('Invalid email or password')

  if (!user.password_hash) {
    const provider = user.oauth_provider ?? 'OAuth'
    throw new Error(`This account uses ${provider} sign-in. Use the ${provider} button instead.`)
  }

  const valid = await bcrypt.compare(password, user.password_hash)
  if (!valid) throw new Error('Invalid email or password')

  const token = signToken(user)
  return { token, user: { id: user.id, email: user.email } }
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload
  } catch {
    return null
  }
}

export function getUserFromToken(token: string): UserRow | null {
  const payload = verifyToken(token)
  if (!payload) return null
  return findUserById(payload.userId) ?? null
}

function signToken(user: UserRow): string {
  const payload: JwtPayload = { userId: user.id, email: user.email }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export function signTokenForOAuth(user: UserRow): string {
  return signToken(user)
}
