import type { UserProfile, UserProfilePatch } from "../types/domain";

type UserRow = {
  id: string;
  email: string | null;
  name: string | null;
  ai_nickname: string | null;
  profile_status: UserProfile["profileStatus"] | null;
  created_at: string;
  updated_at: string;
};

export class UserRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<UserProfile | null> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
    return row ? toUserProfile(row) : null;
  }

  async create(id: string): Promise<UserProfile> {
    await this.db.prepare("INSERT INTO users (id) VALUES (?)").bind(id).run();
    const user = await this.findById(id);

    if (!user) {
      throw new Error("Failed to create user profile");
    }

    return user;
  }

  async ensureUser(id: string): Promise<UserProfile> {
    const existing = await this.findById(id);
    return existing ?? this.create(id);
  }

  async update(id: string, patch: UserProfilePatch): Promise<UserProfile> {
    const assignments: string[] = [];
    const values: string[] = [];

    if (patch.email !== undefined) {
      assignments.push("email = ?");
      values.push(patch.email);
    }

    if (patch.name !== undefined) {
      assignments.push("name = ?");
      values.push(patch.name);
    }

    if (patch.aiNickname !== undefined) {
      assignments.push("ai_nickname = ?");
      values.push(patch.aiNickname);
    }

    if (patch.profileStatus !== undefined) {
      assignments.push("profile_status = ?");
      values.push(patch.profileStatus);
    }

    if (assignments.length > 0) {
      assignments.push("updated_at = CURRENT_TIMESTAMP");
      await this.db
        .prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`)
        .bind(...values, id)
        .run();
    }

    const user = await this.findById(id);

    if (!user) {
      throw new Error("Failed to update user profile");
    }

    return user;
  }
}

function toUserProfile(row: UserRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    aiNickname: row.ai_nickname ?? "XVC",
    profileStatus: row.profile_status ?? "pending",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
