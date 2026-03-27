import * as fs from "fs";
import { getDatabasePath, ensureDatabaseDirectory } from "./config";

ensureDatabaseDirectory();

const dbPath = getDatabasePath();

// Initialize database with schema
export function initializeDatabase(): void {
  const db = fs.readFileSync(dbPath, "utf-8");
}

// Simple key-value store using JSON
const getData = (): Record<string, unknown> => {
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf-8"));
  } catch {
    return {};
  }
};

const setData = (data: Record<string, unknown>): void => {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
};

// User operations
export const userDb = {
  findById: (id: string): unknown => {
    const data = getData();
    return (data.users as Record<string, unknown>)?.[id];
  },
  findByEmail: (email: string): unknown => {
    const data = getData();
    const users = (data.users as Record<string, unknown>) || {};
    return Object.values(users).find((u: unknown) => (u as Record<string, unknown>).email === email);
  },
  findAll: (): unknown[] => {
    const data = getData();
    return Object.values((data.users as Record<string, unknown>) || {});
  },
  create: (user: unknown): unknown => {
    const data = getData();
    if (!data.users) {
      data.users = {};
    }
    const userRecord = user as Record<string, unknown>;
    (data.users as Record<string, unknown>)[userRecord.id as unknown as string] = user;
    setData(data);
    return user;
  },
  update: (id: string, updates: unknown): unknown => {
    const data = getData();
    const user = (data.users as Record<string, unknown>)?.[id];
    if (user) {
      const updatedUser = { ...user, ...updates, updatedAt: new Date().toISOString() };
      (data.users as Record<string, unknown>)[id] = updatedUser;
      setData(data);
      return updatedUser;
    }
    return null;
  },
  delete: (id: string): boolean => {
    const data = getData();
    if ((data.users as Record<string, unknown>)?.[id]) {
      delete (data.users as Record<string, unknown>)[id];
      setData(data);
      return true;
    }
    return false;
  }
};

