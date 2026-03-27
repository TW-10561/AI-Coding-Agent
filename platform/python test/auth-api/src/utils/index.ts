// Utility functions

import * as crypto from "crypto";

// Configuration
const HASH_ROUNDS = 12;

/**
 * Hash a password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  // Using Node.js crypto for hashing (simulating bcrypt)
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.promise.scrypt(password, salt, 64);
  return `${salt}${(await hash).toString("hex")}`;
}

/**
 * Verify a password against a hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt] = hash.split("$");
  const passwordHash = await crypto.promise.scrypt(password, salt, 64);
  return hash === `${salt}${(await passwordHash).toString("hex")}`;
}

/**
 * Generate a random token
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^@]+@[^@]+\.[a-z]+$/;
  return emailRegex.test(email);
}

/**
 * Validate password strength
 */
export function isValidPassword(password: string): boolean {
  // At least 8 chars, 1 number, 1 lowercase, 1 uppercase
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
  return passwordRegex.test(password);
}

/**
 * Sanitize user input
 */
export function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

